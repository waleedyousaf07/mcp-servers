import { promises as fs } from "node:fs";
import path from "node:path";
import envPaths from "env-paths";
import { APP_STORAGE_NAME } from "./constants.js";
import type { Logger } from "./logger.js";

export interface StoredToken {
  accessToken?: string;
  refreshToken: string;
  expiryDate?: number;
  scope?: string;
  tokenType?: string;
}

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export class TokenStore {
  private readonly tokenFilePath: string;
  private readonly logger: Logger;
  private readonly useKeytar: boolean;
  private keytarPromise?: Promise<KeytarLike | null>;

  constructor(options: { logger: Logger; useKeytar: boolean }) {
    const paths = envPaths(APP_STORAGE_NAME);
    this.tokenFilePath = path.join(paths.config, "token.json");
    this.logger = options.logger;
    this.useKeytar = options.useKeytar;
  }

  async load(): Promise<StoredToken | null> {
    const keytar = await this.getKeytar();
    if (keytar) {
      try {
        const raw = await keytar.getPassword(APP_STORAGE_NAME, "oauth-token");
        if (raw) {
          return JSON.parse(raw) as StoredToken;
        }
      } catch (error) {
        this.logger.warn("keytar_load_failed", { error: String(error) });
      }
    }

    try {
      const raw = await fs.readFile(this.tokenFilePath, "utf8");
      return JSON.parse(raw) as StoredToken;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.warn("token_file_read_failed", { error: String(error) });
      }
      return null;
    }
  }

  async save(token: StoredToken): Promise<void> {
    const keytar = await this.getKeytar();
    if (keytar) {
      try {
        await keytar.setPassword(APP_STORAGE_NAME, "oauth-token", JSON.stringify(token));
        return;
      } catch (error) {
        this.logger.warn("keytar_save_failed", { error: String(error) });
      }
    }

    await fs.mkdir(path.dirname(this.tokenFilePath), { recursive: true });
    await fs.writeFile(this.tokenFilePath, `${JSON.stringify(token, null, 2)}\n`, "utf8");
  }

  async clear(): Promise<void> {
    const keytar = await this.getKeytar();
    if (keytar) {
      try {
        await keytar.deletePassword(APP_STORAGE_NAME, "oauth-token");
      } catch (error) {
        this.logger.warn("keytar_delete_failed", { error: String(error) });
      }
    }

    try {
      await fs.unlink(this.tokenFilePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.warn("token_file_delete_failed", { error: String(error) });
      }
    }
  }

  get path(): string {
    return this.tokenFilePath;
  }

  private async getKeytar(): Promise<KeytarLike | null> {
    if (!this.useKeytar) {
      return null;
    }

    if (!this.keytarPromise) {
      this.keytarPromise = import("keytar")
        .then((module) => module.default ?? module)
        .catch((error) => {
          this.logger.warn("keytar_unavailable", { error: String(error) });
          return null;
        });
    }

    return this.keytarPromise;
  }
}
