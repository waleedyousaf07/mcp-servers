import { once } from "node:events";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import {
  DEFAULT_AUTH_TIMEOUT_MS,
  DOCS_SCOPE,
  DRIVE_METADATA_READ_SCOPE,
  GOOGLE_AUTH_ROOT,
  GOOGLE_TOKEN_URL
} from "./constants.js";
import { ToolExecutionError, mapGoogleApiError } from "./errors.js";
import type { Logger } from "./logger.js";
import type { StoredToken, TokenStore } from "./token-store.js";
import { htmlEscape, openBrowser, parseBooleanEnv, randomId } from "./utils.js";

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

interface TokenEndpointResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface OAuthSessionOptions {
  credentials: OAuthCredentials;
  logger: Logger;
  tokenStore: TokenStore;
  fetchImpl?: typeof fetch;
}

export class OAuthSession {
  private readonly credentials: OAuthCredentials;
  private readonly logger: Logger;
  private readonly tokenStore: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly scopes: string[];
  private cachedToken?: StoredToken | null;

  constructor(options: OAuthSessionOptions) {
    this.credentials = options.credentials;
    this.logger = options.logger;
    this.tokenStore = options.tokenStore;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.scopes = [DOCS_SCOPE, DRIVE_METADATA_READ_SCOPE];
  }

  get scopeList(): string[] {
    return [...this.scopes];
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    let token = this.cachedToken;
    if (!token) {
      token = await this.tokenStore.load();
      this.cachedToken = token;
    }

    if (!token) {
      token = await this.authorizeInteractive();
      this.cachedToken = token;
    }

    const expiresSoon =
      typeof token.expiryDate === "number" ? token.expiryDate - Date.now() < 30_000 : false;

    if (forceRefresh || !token.accessToken || expiresSoon) {
      token = await this.refreshOrReauthorize(token);
      this.cachedToken = token;
    }

    if (!token.accessToken) {
      throw new ToolExecutionError("No access token available after authentication.", {
        kind: "auth_error"
      });
    }

    return token.accessToken;
  }

  private async refreshOrReauthorize(token: StoredToken): Promise<StoredToken> {
    if (token.refreshToken) {
      try {
        const refreshed = await this.refreshToken(token.refreshToken);
        const merged: StoredToken = {
          refreshToken: refreshed.refreshToken ?? token.refreshToken,
          accessToken: refreshed.accessToken,
          expiryDate: refreshed.expiryDate,
          scope: refreshed.scope ?? token.scope,
          tokenType: refreshed.tokenType ?? token.tokenType
        };
        await this.tokenStore.save(merged);
        return merged;
      } catch (error) {
        if (error instanceof ToolExecutionError && error.kind === "auth_error") {
          this.logger.warn("refresh_token_invalid_reauthorizing", {});
          await this.tokenStore.clear();
        } else {
          throw error;
        }
      }
    }

    return this.authorizeInteractive();
  }

  private async authorizeInteractive(): Promise<StoredToken> {
    const state = randomId();
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new ToolExecutionError("Failed to start local OAuth callback server.", {
        kind: "auth_error"
      });
    }

    const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
    const authUrl = new URL(GOOGLE_AUTH_ROOT);
    authUrl.searchParams.set("client_id", this.credentials.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", this.scopes.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);

    const authPromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new ToolExecutionError("Timed out waiting for Google OAuth approval.", {
            kind: "auth_error"
          })
        );
      }, DEFAULT_AUTH_TIMEOUT_MS);

      server.on("request", (req, res) => {
        const requestUrl = new URL(req.url ?? "/", redirectUri);
        if (requestUrl.pathname !== "/oauth2/callback") {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        const incomingState = requestUrl.searchParams.get("state");
        const code = requestUrl.searchParams.get("code");
        const error = requestUrl.searchParams.get("error");

        if (error) {
          clearTimeout(timer);
          res.statusCode = 400;
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.end(
            `<html><body><h1>Authorization failed</h1><p>${htmlEscape(error)}</p></body></html>`
          );
          reject(
            new ToolExecutionError(`Google OAuth authorization failed: ${error}.`, {
              kind: "auth_error"
            })
          );
          return;
        }

        if (!code || incomingState !== state) {
          clearTimeout(timer);
          res.statusCode = 400;
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.end("<html><body><h1>Authorization failed</h1><p>Invalid state.</p></body></html>");
          reject(
            new ToolExecutionError("Google OAuth callback did not include a valid code.", {
              kind: "auth_error"
            })
          );
          return;
        }

        clearTimeout(timer);
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(
          "<html><body><h1>Google Docs MCP authorized</h1><p>You can close this tab.</p></body></html>"
        );
        resolve(code);
      });
    });

    const opened = await openBrowser(authUrl.toString());
    if (!opened) {
      this.logger.warn("oauth_browser_open_failed", { authUrl: authUrl.toString() });
    } else {
      this.logger.info("oauth_browser_opened", {});
    }

    this.logger.info("oauth_authorization_required", {
      authUrl: authUrl.toString(),
      note: "Open the URL manually if your browser did not launch."
    });

    try {
      const code = await authPromise;
      const token = await this.exchangeCodeForToken(code, redirectUri);
      await this.tokenStore.save(token);
      this.logger.info("oauth_authorization_complete", { tokenPath: this.tokenStore.path });
      return token;
    } finally {
      server.close();
      await once(server, "close").catch(() => undefined);
    }
  }

  private async exchangeCodeForToken(code: string, redirectUri: string): Promise<StoredToken> {
    const body = new URLSearchParams();
    body.set("code", code);
    body.set("client_id", this.credentials.clientId);
    body.set("client_secret", this.credentials.clientSecret);
    body.set("redirect_uri", redirectUri);
    body.set("grant_type", "authorization_code");

    const response = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    });

    const payload = (await response.json()) as TokenEndpointResponse;
    if (!response.ok || !payload.access_token || !payload.refresh_token) {
      throw mapGoogleApiError(response.status, payload, "oauth.authorization_code");
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiryDate:
        typeof payload.expires_in === "number" ? Date.now() + payload.expires_in * 1000 : undefined,
      scope: payload.scope,
      tokenType: payload.token_type
    };
  }

  private async refreshToken(refreshToken: string): Promise<StoredToken> {
    const body = new URLSearchParams();
    body.set("refresh_token", refreshToken);
    body.set("client_id", this.credentials.clientId);
    body.set("client_secret", this.credentials.clientSecret);
    body.set("grant_type", "refresh_token");

    const response = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    });

    const payload = (await response.json()) as TokenEndpointResponse;
    if (!response.ok || !payload.access_token) {
      const mapped = mapGoogleApiError(response.status, payload, "oauth.refresh_token");
      if (payload.error === "invalid_grant") {
        throw new ToolExecutionError("Stored Google refresh token is no longer valid.", {
          kind: "auth_error",
          status: response.status,
          details: mapped.details
        });
      }

      throw mapped;
    }

    return {
      accessToken: payload.access_token,
      refreshToken,
      expiryDate:
        typeof payload.expires_in === "number" ? Date.now() + payload.expires_in * 1000 : undefined,
      scope: payload.scope,
      tokenType: payload.token_type
    };
  }
}

export async function loadOAuthCredentialsFromEnvironment(): Promise<OAuthCredentials> {
  const clientId = process.env.MCP_GOOGLE_DOCS_CLIENT_ID?.trim();
  const clientSecret = process.env.MCP_GOOGLE_DOCS_CLIENT_SECRET?.trim();

  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  const credentialsPath = process.env.MCP_GOOGLE_DOCS_CLIENT_CREDENTIALS_PATH?.trim();
  if (!credentialsPath) {
    throw new ToolExecutionError(
      "Missing Google OAuth credentials. Set MCP_GOOGLE_DOCS_CLIENT_ID and MCP_GOOGLE_DOCS_CLIENT_SECRET, or MCP_GOOGLE_DOCS_CLIENT_CREDENTIALS_PATH.",
      { kind: "config_error" }
    );
  }

  const raw = await fs.readFile(credentialsPath, "utf8");
  const parsed = JSON.parse(raw) as {
    installed?: {
      client_id?: string;
      client_secret?: string;
    };
    client_id?: string;
    client_secret?: string;
  };

  const resolvedClientId = parsed.installed?.client_id ?? parsed.client_id;
  const resolvedClientSecret = parsed.installed?.client_secret ?? parsed.client_secret;

  if (!resolvedClientId || !resolvedClientSecret) {
    throw new ToolExecutionError(
      "Google OAuth credential file is missing client_id or client_secret.",
      { kind: "config_error" }
    );
  }

  return {
    clientId: resolvedClientId,
    clientSecret: resolvedClientSecret
  };
}

export function isKeytarEnabled(): boolean {
  return parseBooleanEnv(process.env.MCP_GOOGLE_DOCS_USE_KEYTAR);
}
