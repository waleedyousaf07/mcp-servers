import { BODY_BYTE_LIMIT, GMAIL_API_ROOT } from "./constants.js";
import { ToolExecutionError, mapGoogleApiError } from "./errors.js";
import type { Logger } from "./logger.js";
import type { OAuthSession } from "./oauth.js";
import {
  base64UrlEncode,
  decodeBase64Url,
  encodeQuery,
  joinAddressList,
  sleep,
  truncateUtf8
} from "./utils.js";

type BodyFormat = "text" | "html" | "both";

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailPartBody {
  data?: string;
}

interface GmailPart {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: GmailPartBody;
  parts?: GmailPart[];
}

interface GmailMessageResource {
  id?: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
}

interface GmailThreadResource {
  messages?: GmailMessageResource[];
}

interface GmailThreadListResponse {
  threads?: Array<{
    id?: string;
    historyId?: string;
    snippet?: string;
  }>;
  nextPageToken?: string;
}

interface GmailLabelListResponse {
  labels?: Array<{
    id?: string;
    name?: string;
    type?: string;
  }>;
}

interface GmailDraftResponse {
  id?: string;
  message?: {
    id?: string;
    threadId?: string;
  };
}

interface GmailSendResponse {
  id?: string;
  threadId?: string;
}

export interface SearchResult {
  threads: Array<{
    threadId: string;
    snippet?: string;
    historyId?: string;
    messageCount?: number;
    lastInternalDate?: number;
  }>;
  nextPageToken?: string;
}

export interface SimpleMessage {
  messageId: string;
  internalDate?: number;
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  snippet?: string;
  body?: {
    text?: string;
    html?: string;
  };
}

export interface ThreadResult {
  threadId: string;
  messages: SimpleMessage[];
}

export interface CreateDraftInput {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  body: {
    text?: string;
    html?: string;
  };
  replyToMessageId?: string;
  threadId?: string;
}

export class GmailClient {
  private readonly auth: OAuthSession;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { auth: OAuthSession; logger: Logger; fetchImpl?: typeof fetch }) {
    this.auth = options.auth;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async searchThreads(input: {
    query: string;
    maxResults: number;
    includeSnippet: boolean;
  }): Promise<SearchResult> {
    const page = await this.requestJson<GmailThreadListResponse>(
      "gmail.search",
      `/threads${encodeQuery({
        q: input.query,
        maxResults: input.maxResults
      })}`
    );

    const threads = [];
    for (const item of page.threads ?? []) {
      if (!item.id) {
        continue;
      }

      let messageCount: number | undefined;
      let lastInternalDate: number | undefined;

      try {
        const detail = await this.getThread(item.id, false, "text", 100);
        messageCount = detail.messages.length;
        lastInternalDate = detail.messages.reduce<number | undefined>((latest, message) => {
          if (message.internalDate === undefined) {
            return latest;
          }
          if (latest === undefined) {
            return message.internalDate;
          }
          return Math.max(latest, message.internalDate);
        }, undefined);
      } catch (error) {
        this.logger.warn("thread_metadata_probe_failed", {
          threadId: item.id,
          error: String(error)
        });
      }

      threads.push({
        threadId: item.id,
        snippet: input.includeSnippet ? item.snippet : undefined,
        historyId: item.historyId,
        messageCount,
        lastInternalDate
      });
    }

    return {
      threads,
      nextPageToken: page.nextPageToken
    };
  }

  async getThread(
    threadId: string,
    includeBodies: boolean,
    bodyFormat: BodyFormat,
    maxMessages: number
  ): Promise<ThreadResult> {
    const format = includeBodies ? "full" : "metadata";
    const thread = await this.requestJson<GmailThreadResource>(
      "gmail.getThread",
      `/threads/${encodeURIComponent(threadId)}${encodeQuery({ format })}`
    );

    const messages = (thread.messages ?? [])
      .slice(0, maxMessages)
      .map((message) => simplifyMessage(message, { includeBodies, bodyFormat }));

    return {
      threadId,
      messages
    };
  }

  async getMessage(
    messageId: string,
    includeBody: boolean,
    bodyFormat: BodyFormat
  ): Promise<SimpleMessage> {
    const format = includeBody ? "full" : "metadata";
    const message = await this.requestJson<GmailMessageResource>(
      "gmail.getMessage",
      `/messages/${encodeURIComponent(messageId)}${encodeQuery({ format })}`
    );

    return simplifyMessage(message, { includeBodies: includeBody, bodyFormat });
  }

  async listLabels(): Promise<{
    labels: Array<{
      id: string;
      name: string;
      type?: string;
    }>;
  }> {
    const response = await this.requestJson<GmailLabelListResponse>("gmail.listLabels", "/labels");

    return {
      labels: (response.labels ?? [])
        .filter((label): label is { id: string; name: string; type?: string } =>
          Boolean(label.id && label.name)
        )
        .map((label) => ({
          id: label.id,
          name: label.name,
          type: label.type
        }))
    };
  }

  async createDraft(input: CreateDraftInput): Promise<{
    draftId: string;
    messageId?: string;
    threadId?: string;
  }> {
    const prepared = await this.prepareMessageInput(input);
    const response = await this.requestJson<GmailDraftResponse>("gmail.createDraft", "/drafts", {
      method: "POST",
      body: JSON.stringify({
        message: {
          raw: prepared.raw,
          threadId: prepared.threadId
        }
      })
    });

    if (!response.id) {
      throw new ToolExecutionError("Google returned a draft response without an id.", {
        kind: "api_error"
      });
    }

    return {
      draftId: response.id,
      messageId: response.message?.id,
      threadId: response.message?.threadId
    };
  }

  async sendDraft(draftId: string): Promise<{ messageId: string; threadId?: string }> {
    const response = await this.requestJson<GmailSendResponse>("gmail.sendMessage", "/drafts/send", {
      method: "POST",
      body: JSON.stringify({ id: draftId })
    });

    if (!response.id) {
      throw new ToolExecutionError("Google returned a send response without a message id.", {
        kind: "api_error"
      });
    }

    return {
      messageId: response.id,
      threadId: response.threadId
    };
  }

  async sendMessage(input: CreateDraftInput): Promise<{ messageId: string; threadId?: string }> {
    const prepared = await this.prepareMessageInput(input);
    const response = await this.requestJson<GmailSendResponse>(
      "gmail.sendMessage",
      "/messages/send",
      {
        method: "POST",
        body: JSON.stringify({
          raw: prepared.raw,
          threadId: prepared.threadId
        })
      }
    );

    if (!response.id) {
      throw new ToolExecutionError("Google returned a send response without a message id.", {
        kind: "api_error"
      });
    }

    return {
      messageId: response.id,
      threadId: response.threadId
    };
  }

  private async prepareMessageInput(input: CreateDraftInput): Promise<{
    raw: string;
    threadId?: string;
  }> {
    let threadId = input.threadId;
    let inReplyTo: string | undefined;
    let references: string | undefined;

    if (input.replyToMessageId) {
      const replyMessage = await this.requestJson<GmailMessageResource>(
        "gmail.replyMetadata",
        `/messages/${encodeURIComponent(input.replyToMessageId)}${encodeQuery({ format: "metadata" })}`
      );

      threadId = threadId ?? replyMessage.threadId;
      const headers = headerMap(replyMessage.payload?.headers);
      inReplyTo = headers["message-id"];
      references = headers["references"] ?? inReplyTo;
    }

    return {
      raw: buildRawMimeMessage(input, { inReplyTo, references }),
      threadId
    };
  }

  private async requestJson<T>(
    operation: string,
    path: string,
    init?: RequestInit,
    attempt = 0,
    hasRetriedAfterRefresh = false
  ): Promise<T> {
    const token = await this.auth.getAccessToken(false);
    const started = Date.now();

    try {
      const response = await this.fetchImpl(`${GMAIL_API_ROOT}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(init?.headers ?? {})
        }
      });

      if (response.status === 401 && !hasRetriedAfterRefresh) {
        await this.auth.getAccessToken(true);
        return this.requestJson<T>(operation, path, init, attempt, true);
      }

      if (!response.ok) {
        const payload = await parseJsonSafely(response);
        if (shouldRetry(response.status) && attempt < 3) {
          await sleep(retryDelayMs(attempt));
          return this.requestJson<T>(operation, path, init, attempt + 1, hasRetriedAfterRefresh);
        }
        throw mapGoogleApiError(response.status, payload, operation);
      }

      const payload = (await parseJsonSafely(response)) as T;
      this.logger.info("gmail_request_complete", {
        operation,
        durationMs: Date.now() - started
      });
      return payload;
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        throw error;
      }

      if (attempt < 3) {
        await sleep(retryDelayMs(attempt));
        return this.requestJson<T>(operation, path, init, attempt + 1, hasRetriedAfterRefresh);
      }

      throw new ToolExecutionError(`Network failure during ${operation}.`, {
        kind: "network_error",
        cause: error
      });
    }
  }
}

function shouldRetry(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(attempt: number): number {
  const base = 250 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 150);
  return base + jitter;
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function simplifyMessage(
  message: GmailMessageResource,
  options: { includeBodies: boolean; bodyFormat: BodyFormat }
): SimpleMessage {
  if (!message.id) {
    throw new ToolExecutionError("Google returned a message without an id.", {
      kind: "api_error"
    });
  }

  const headers = headerMap(message.payload?.headers);
  const body = options.includeBodies
    ? extractBodies(message.payload, options.bodyFormat, BODY_BYTE_LIMIT)
    : undefined;

  return {
    messageId: message.id,
    internalDate: message.internalDate ? Number(message.internalDate) : undefined,
    from: headers["from"],
    to: headers["to"],
    cc: headers["cc"],
    subject: headers["subject"],
    snippet: message.snippet,
    body
  };
}

function extractBodies(
  payload: GmailPart | undefined,
  bodyFormat: BodyFormat,
  maxBytes: number
): { text?: string; html?: string } | undefined {
  if (!payload) {
    return undefined;
  }

  const pieces = collectBodyParts(payload);
  let remaining = maxBytes;
  const body: { text?: string; html?: string } = {};

  if (bodyFormat === "text" || bodyFormat === "both") {
    const text = pieces.text.join("\n\n").trim();
    if (text) {
      const truncated = truncateUtf8(text, remaining);
      remaining -= Buffer.byteLength(truncated, "utf8");
      body.text = truncated;
    }
  }

  if (remaining > 0 && (bodyFormat === "html" || bodyFormat === "both")) {
    const html = pieces.html.join("\n").trim();
    if (html) {
      body.html = truncateUtf8(html, remaining);
    }
  }

  return body.text || body.html ? body : undefined;
}

function collectBodyParts(part: GmailPart): { text: string[]; html: string[] } {
  const text: string[] = [];
  const html: string[] = [];

  const visit = (current: GmailPart): void => {
    if (current.parts?.length) {
      for (const child of current.parts) {
        visit(child);
      }
      return;
    }

    const data = current.body?.data;
    if (!data) {
      return;
    }

    if (current.mimeType === "text/plain") {
      text.push(decodeBase64Url(data));
    } else if (current.mimeType === "text/html") {
      html.push(decodeBase64Url(data));
    }
  };

  visit(part);
  return { text, html };
}

function headerMap(headers?: GmailHeader[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of headers ?? []) {
    if (!header.name || !header.value) {
      continue;
    }
    out[header.name.toLowerCase()] = header.value;
  }
  return out;
}

function buildRawMimeMessage(
  input: CreateDraftInput,
  options?: { inReplyTo?: string; references?: string }
): string {
  const headers = [
    `To: ${joinAddressList(input.to) ?? ""}`,
    ...(input.cc ? [`Cc: ${joinAddressList(input.cc)}`] : []),
    ...(input.bcc ? [`Bcc: ${joinAddressList(input.bcc)}`] : []),
    `Subject: ${sanitizeHeader(input.subject)}`,
    "MIME-Version: 1.0"
  ];

  if (options?.inReplyTo) {
    headers.push(`In-Reply-To: ${sanitizeHeader(options.inReplyTo)}`);
  }
  if (options?.references) {
    headers.push(`References: ${sanitizeHeader(options.references)}`);
  }

  let body = "";

  if (input.body.text && input.body.html) {
    const boundary = `mcp-gmail-${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      input.body.text,
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      input.body.html,
      `--${boundary}--`,
      ""
    ].join("\r\n");
  } else if (input.body.html) {
    headers.push("Content-Type: text/html; charset=utf-8");
    body = input.body.html;
  } else {
    headers.push("Content-Type: text/plain; charset=utf-8");
    body = input.body.text ?? "";
  }

  const mime = `${headers.join("\r\n")}\r\n\r\n${body}`;
  return base64UrlEncode(mime);
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}
