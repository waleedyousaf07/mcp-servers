import {
  DOCS_API_ROOT,
  DOCUMENT_SEARCH_DEFAULT_MAX_RESULTS,
  DRIVE_API_ROOT,
  RESOLVER_CANDIDATE_MAX_RESULTS
} from "./constants.js";
import { ToolExecutionError, mapGoogleApiError } from "./errors.js";
import type { Logger } from "./logger.js";
import type { OAuthSession } from "./oauth.js";
import type { DocumentReferenceInput } from "./tools.js";
import { encodeQuery, sleep } from "./utils.js";

const DOCS_MIME_TYPE = "application/vnd.google-apps.document";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

interface DriveFileResource {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  createdTime?: string;
  webViewLink?: string;
  parents?: string[];
}

interface DriveFileListResponse {
  files?: DriveFileResource[];
  nextPageToken?: string;
}

interface DocumentResource {
  documentId?: string;
  title?: string;
  revisionId?: string;
  [key: string]: unknown;
}

interface BatchUpdateResponse {
  documentId?: string;
  replies?: unknown[];
  writeControl?: {
    requiredRevisionId?: string;
  };
}

interface ReplaceAllTextReply {
  replaceAllText?: {
    occurrencesChanged?: number;
  };
}

type WriteControl = {
  requiredRevisionId?: string;
  targetRevisionId?: string;
};

interface ResolvedCandidate {
  fileId?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  createdTime?: string;
  webViewLink?: string;
  parents?: string[];
}

interface ResolverErrorDetails {
  operation: string;
  referenceType: "name" | "path";
  referenceValue: string;
  candidates: ResolvedCandidate[];
  resolvedFolderSegments?: string[];
}

export class GoogleDocsClient {
  private readonly auth: OAuthSession;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { auth: OAuthSession; logger: Logger; fetchImpl?: typeof fetch }) {
    this.auth = options.auth;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async searchDocuments(input: {
    query?: string;
    maxResults: number;
    pageToken?: string;
    includeTrashed: boolean;
  }): Promise<{
    documents: Array<{
      documentId: string;
      name?: string;
      mimeType?: string;
      modifiedTime?: string;
      createdTime?: string;
      webViewLink?: string;
      parents?: string[];
    }>;
    nextPageToken?: string;
  }> {
    const queryParts = [`mimeType='${DOCS_MIME_TYPE}'`];
    if (!input.includeTrashed) {
      queryParts.push("trashed=false");
    }
    if (input.query) {
      queryParts.push(`name contains '${escapeDriveQueryValue(input.query)}'`);
    }

    const response = await this.listDriveFiles({
      operation: "docs.searchDocuments",
      q: queryParts.join(" and "),
      pageSize: input.maxResults || DOCUMENT_SEARCH_DEFAULT_MAX_RESULTS,
      pageToken: input.pageToken
    });

    return {
      documents: (response.files ?? [])
        .filter((item): item is DriveFileResource & { id: string } => Boolean(item.id))
        .map((item) => ({
          documentId: item.id,
          name: item.name,
          mimeType: item.mimeType,
          modifiedTime: item.modifiedTime,
          createdTime: item.createdTime,
          webViewLink: item.webViewLink,
          parents: item.parents
        })),
      nextPageToken: response.nextPageToken
    };
  }

  async getDocument(
    reference: DocumentReferenceInput,
    includeTabsContent: boolean
  ): Promise<{
    documentId: string;
    document: DocumentResource;
  }> {
    const documentId = await this.resolveDocumentId(reference, "docs.getDocument");
    const document = await this.requestJson<DocumentResource>(
      "docs.getDocument",
      `${DOCS_API_ROOT}/documents/${encodeURIComponent(documentId)}${encodeQuery({
        includeTabsContent
      })}`
    );

    return {
      documentId,
      document
    };
  }

  async createDocument(input: {
    title: string;
    initialText?: string;
  }): Promise<{
    documentId: string;
    title?: string;
    revisionId?: string;
    documentUrl: string;
  }> {
    const created = await this.requestJson<DocumentResource>("docs.createDocument", `${DOCS_API_ROOT}/documents`, {
      method: "POST",
      body: JSON.stringify({
        title: input.title
      })
    });

    if (!created.documentId) {
      throw new ToolExecutionError("Google returned a document response without documentId.", {
        kind: "api_error"
      });
    }

    if (input.initialText) {
      await this.performBatchUpdate(
        created.documentId,
        [
          {
            insertText: {
              location: {
                index: 1
              },
              text: input.initialText
            }
          }
        ],
        undefined,
        "docs.createDocument.insertInitialText"
      );
    }

    return {
      documentId: created.documentId,
      title: created.title,
      revisionId: created.revisionId,
      documentUrl: toDocumentUrl(created.documentId)
    };
  }

  async insertText(
    reference: DocumentReferenceInput,
    input: {
      text: string;
      index: number;
    }
  ): Promise<{
    documentId: string;
    replyCount: number;
    writeControl?: {
      requiredRevisionId?: string;
    };
  }> {
    const documentId = await this.resolveDocumentId(reference, "docs.insertText");
    const response = await this.performBatchUpdate(
      documentId,
      [
        {
          insertText: {
            location: {
              index: input.index
            },
            text: input.text
          }
        }
      ],
      undefined,
      "docs.insertText"
    );

    return {
      documentId,
      replyCount: response.replies?.length ?? 0,
      writeControl: response.writeControl
    };
  }

  async replaceAllText(
    reference: DocumentReferenceInput,
    input: {
      searchText: string;
      replaceText: string;
      matchCase: boolean;
    }
  ): Promise<{
    documentId: string;
    occurrencesChanged: number;
    writeControl?: {
      requiredRevisionId?: string;
    };
  }> {
    const documentId = await this.resolveDocumentId(reference, "docs.replaceAllText");
    const response = await this.performBatchUpdate(
      documentId,
      [
        {
          replaceAllText: {
            containsText: {
              text: input.searchText,
              matchCase: input.matchCase
            },
            replaceText: input.replaceText
          }
        }
      ],
      undefined,
      "docs.replaceAllText"
    );

    const firstReply = response.replies?.[0] as
      | {
          replaceAllText?: {
            occurrencesChanged?: number;
          };
        }
      | undefined;

    return {
      documentId,
      occurrencesChanged: firstReply?.replaceAllText?.occurrencesChanged ?? 0,
      writeControl: response.writeControl
    };
  }

  async batchUpdate(
    reference: DocumentReferenceInput,
    input: {
      requests: Array<Record<string, unknown>>;
      writeControl?: WriteControl;
    }
  ): Promise<{
    documentId: string;
    replies?: unknown[];
    writeControl?: {
      requiredRevisionId?: string;
    };
  }> {
    const documentId = await this.resolveDocumentId(reference, "docs.batchUpdate");
    const response = await this.performBatchUpdate(
      documentId,
      input.requests,
      input.writeControl,
      "docs.batchUpdate"
    );

    return {
      documentId,
      replies: response.replies,
      writeControl: response.writeControl
    };
  }

  async copyTemplateToFolder(
    reference: DocumentReferenceInput,
    input: {
      folderId?: string;
      folderUrl?: string;
      title: string;
      replacements: Array<{ searchText: string; replaceText: string }>;
      strictPlaceholderCheck: boolean;
      matchCase: boolean;
    }
  ): Promise<{
    templateDocumentId: string;
    documentId: string;
    documentUrl: string;
    folderId: string;
    title?: string;
    placeholderResults: Array<{ searchText: string; occurrencesChanged: number }>;
  }> {
    const templateDocumentId = await this.resolveDocumentId(reference, "docs.copyTemplateToFolder");
    const folderId = resolveFolderId(input.folderId, input.folderUrl);
    const copied = await this.requestJson<DriveFileResource>(
      "docs.copyTemplateToFolder.copy",
      `${DRIVE_API_ROOT}/files/${encodeURIComponent(templateDocumentId)}/copy`,
      {
        method: "POST",
        body: JSON.stringify({
          name: input.title,
          parents: [folderId]
        })
      }
    );

    if (!copied.id) {
      throw new ToolExecutionError("Google returned a copy response without file id.", {
        kind: "api_error"
      });
    }

    const placeholderResults: Array<{ searchText: string; occurrencesChanged: number }> = [];
    if (input.replacements.length > 0) {
      const response = await this.performBatchUpdate(
        copied.id,
        input.replacements.map((item) => ({
          replaceAllText: {
            containsText: {
              text: item.searchText,
              matchCase: input.matchCase
            },
            replaceText: item.replaceText
          }
        })),
        undefined,
        "docs.copyTemplateToFolder.replaceAllText"
      );

      const replies = Array.isArray(response.replies) ? response.replies : [];
      for (let index = 0; index < input.replacements.length; index += 1) {
        const replacement = input.replacements[index];
        const reply = replies[index] as ReplaceAllTextReply | undefined;
        const changed = reply?.replaceAllText?.occurrencesChanged ?? 0;
        placeholderResults.push({
          searchText: replacement.searchText,
          occurrencesChanged: changed
        });
      }

      if (input.strictPlaceholderCheck) {
        const missing = placeholderResults
          .filter((entry) => entry.occurrencesChanged < 1)
          .map((entry) => entry.searchText);
        if (missing.length > 0) {
          throw new ToolExecutionError("Missing required placeholders in copied template.", {
            kind: "tool_error",
            details: { missingPlaceholders: missing, documentId: copied.id }
          });
        }
      }
    }

    return {
      templateDocumentId,
      documentId: copied.id,
      documentUrl: toDocumentUrl(copied.id),
      folderId,
      title: copied.name,
      placeholderResults
    };
  }

  private async performBatchUpdate(
    documentId: string,
    requests: Array<Record<string, unknown>>,
    writeControl: WriteControl | undefined,
    operation: string
  ): Promise<BatchUpdateResponse> {
    return this.requestJson<BatchUpdateResponse>(
      operation,
      `${DOCS_API_ROOT}/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      {
        method: "POST",
        body: JSON.stringify({
          requests,
          ...(writeControl ? { writeControl } : {})
        })
      }
    );
  }

  private async resolveDocumentId(
    reference: DocumentReferenceInput,
    operation: string
  ): Promise<string> {
    if (reference.id) {
      return reference.id;
    }

    if (reference.url) {
      const documentId = parseDocumentIdFromUrl(reference.url);
      if (!documentId) {
        throw new ToolExecutionError("Unable to extract a Google document id from url.", {
          kind: "tool_error",
          details: {
            operation,
            referenceType: "url",
            referenceValue: reference.url
          }
        });
      }
      return documentId;
    }

    if (reference.name) {
      return this.resolveByName(reference.name, operation);
    }

    return this.resolveByPath(reference.path!, operation);
  }

  private async resolveByName(name: string, operation: string): Promise<string> {
    const response = await this.listDriveFiles({
      operation,
      q: `mimeType='${DOCS_MIME_TYPE}' and trashed=false and name='${escapeDriveQueryValue(name)}'`,
      pageSize: RESOLVER_CANDIDATE_MAX_RESULTS
    });

    return ensureSingleCandidate(response.files ?? [], {
      operation,
      referenceType: "name",
      referenceValue: name
    });
  }

  private async resolveByPath(path: string, operation: string): Promise<string> {
    const segments = path
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    if (!segments.length) {
      throw new ToolExecutionError("Path reference must contain at least one path segment.", {
        kind: "tool_error",
        details: {
          operation,
          referenceType: "path",
          referenceValue: path
        }
      });
    }

    let parentId = "root";
    const resolvedFolderSegments: string[] = [];

    for (let index = 0; index < segments.length; index += 1) {
      const isLast = index === segments.length - 1;
      const segment = segments[index];
      const mimeType = isLast ? DOCS_MIME_TYPE : FOLDER_MIME_TYPE;
      const response = await this.listDriveFiles({
        operation,
        q: [
          `mimeType='${mimeType}'`,
          "trashed=false",
          `name='${escapeDriveQueryValue(segment)}'`,
          `'${parentId}' in parents`
        ].join(" and "),
        pageSize: RESOLVER_CANDIDATE_MAX_RESULTS
      });

      const fileId = ensureSingleCandidate(response.files ?? [], {
        operation,
        referenceType: "path",
        referenceValue: path,
        resolvedFolderSegments
      });

      if (!isLast) {
        parentId = fileId;
        resolvedFolderSegments.push(segment);
      } else {
        return fileId;
      }
    }

    throw new ToolExecutionError("Unable to resolve document from path.", {
      kind: "not_found",
      details: {
        operation,
        referenceType: "path",
        referenceValue: path,
        candidates: []
      }
    });
  }

  private async listDriveFiles(input: {
    operation: string;
    q: string;
    pageSize: number;
    pageToken?: string;
  }): Promise<DriveFileListResponse> {
    return this.requestJson<DriveFileListResponse>(
      input.operation,
      `${DRIVE_API_ROOT}/files${encodeQuery({
        q: input.q,
        pageSize: input.pageSize,
        pageToken: input.pageToken,
        spaces: "drive",
        fields: "files(id,name,mimeType,modifiedTime,createdTime,webViewLink,parents),nextPageToken"
      })}`
    );
  }

  private async requestJson<T>(
    operation: string,
    url: string,
    init?: RequestInit,
    attempt = 0,
    hasRetriedAfterRefresh = false
  ): Promise<T> {
    const token = await this.auth.getAccessToken(false);
    const started = Date.now();

    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(init?.headers ?? {})
        }
      });

      if (response.status === 401 && !hasRetriedAfterRefresh) {
        await this.auth.getAccessToken(true);
        return this.requestJson<T>(operation, url, init, attempt, true);
      }

      if (!response.ok) {
        const payload = await parseJsonSafely(response);
        if (shouldRetry(response.status) && attempt < 3) {
          await sleep(retryDelayMs(attempt));
          return this.requestJson<T>(operation, url, init, attempt + 1, hasRetriedAfterRefresh);
        }
        throw mapGoogleApiError(response.status, payload, operation);
      }

      const payload = (await parseJsonSafely(response)) as T;
      this.logger.info("docs_request_complete", {
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
        return this.requestJson<T>(operation, url, init, attempt + 1, hasRetriedAfterRefresh);
      }

      throw new ToolExecutionError(`Network failure during ${operation}.`, {
        kind: "network_error",
        cause: error
      });
    }
  }
}

function ensureSingleCandidate(
  files: DriveFileResource[],
  details: Omit<ResolverErrorDetails, "candidates">
): string {
  const normalized = files
    .filter((file): file is DriveFileResource & { id: string } => Boolean(file.id))
    .map(toCandidate);

  if (normalized.length === 1 && normalized[0].fileId) {
    return normalized[0].fileId;
  }

  if (normalized.length === 0) {
    throw new ToolExecutionError("No document matched the provided reference.", {
      kind: "not_found",
      details: {
        ...details,
        candidates: []
      }
    });
  }

  throw new ToolExecutionError("Reference matched multiple documents. Provide id, url, or path.", {
    kind: "tool_error",
    details: {
      ...details,
      candidates: normalized
    }
  });
}

function toCandidate(file: DriveFileResource): ResolvedCandidate {
  return {
    fileId: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    createdTime: file.createdTime,
    webViewLink: file.webViewLink,
    parents: file.parents
  };
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

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function toDocumentUrl(documentId: string): string {
  return `https://docs.google.com/document/d/${documentId}/edit`;
}

export function parseDocumentIdFromUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  const idQuery = parsed.searchParams.get("id");
  if (idQuery) {
    return idQuery;
  }

  const patterns = [/\/document\/d\/([a-zA-Z0-9_-]+)/, /\/file\/d\/([a-zA-Z0-9_-]+)/];
  for (const pattern of patterns) {
    const match = parsed.pathname.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

export function parseFolderIdFromUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  const idQuery = parsed.searchParams.get("id");
  if (idQuery) {
    return idQuery;
  }

  const match = parsed.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match?.[1];
}

function resolveFolderId(folderId?: string, folderUrl?: string): string {
  if (folderId && folderId.trim().length > 0) {
    return folderId.trim();
  }
  if (folderUrl) {
    const parsed = parseFolderIdFromUrl(folderUrl);
    if (parsed) {
      return parsed;
    }
  }
  throw new ToolExecutionError("Unable to resolve folder id from folderId/folderUrl.", {
    kind: "tool_error"
  });
}
