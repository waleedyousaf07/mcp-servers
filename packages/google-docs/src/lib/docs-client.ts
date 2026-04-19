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

interface ComposePlanStyle {
  fontFamily: string;
  fontSizePt: number;
  headingCase: "UPPERCASE" | "TITLE_CASE";
  dateAlignment: "left" | "right";
  compactSpacing: boolean;
  useTables: boolean;
}

interface ComposePlanParagraphBlock {
  type: "paragraph";
  text: string;
}

interface ComposePlanBulletsBlock {
  type: "bullets";
  items: string[];
}

interface ComposePlanExperienceBlock {
  type: "experience_entry";
  role: string;
  company: string;
  dates: string;
  company_description?: string;
  project?: string;
  tech_stack?: string;
  bullets: string[];
}

type ComposePlanBlock = ComposePlanParagraphBlock | ComposePlanBulletsBlock | ComposePlanExperienceBlock;

interface ComposePlanSection {
  heading: string;
  blocks: ComposePlanBlock[];
}

interface ComposePlan {
  document_type: string;
  style: ComposePlanStyle;
  header: {
    name: string;
    title?: string;
    contactLine?: string;
  };
  sections: ComposePlanSection[];
  constraints?: Record<string, unknown>;
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

  async composeFromPlan(
    reference: DocumentReferenceInput,
    input: {
      folderId?: string;
      folderUrl?: string;
      title: string;
      plan: ComposePlan;
      clearTemplateContent: boolean;
    }
  ): Promise<{
    templateDocumentId?: string;
    documentId: string;
    documentUrl: string;
    folderId: string;
    title?: string;
    composeStats: Record<string, unknown>;
  }> {
    const folderId = resolveFolderId(input.folderId, input.folderUrl);
    const hasTemplateReference = hasDocumentReference(reference);
    let templateDocumentId: string | undefined;
    let targetDocumentId: string;
    let targetTitle: string | undefined;

    if (hasTemplateReference) {
      templateDocumentId = await this.resolveDocumentId(reference, "docs.composeFromPlan");
      const copied = await this.requestJson<DriveFileResource>(
        "docs.composeFromPlan.copy",
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

      targetDocumentId = copied.id;
      targetTitle = copied.name;
    } else {
      const created = await this.requestJson<DriveFileResource>(
        "docs.composeFromPlan.create",
        `${DRIVE_API_ROOT}/files`,
        {
          method: "POST",
          body: JSON.stringify({
            name: input.title,
            mimeType: DOCS_MIME_TYPE,
            parents: [folderId]
          })
        }
      );

      if (!created.id) {
        throw new ToolExecutionError("Google returned a create response without file id.", {
          kind: "api_error"
        });
      }

      targetDocumentId = created.id;
      targetTitle = created.name;
    }

    const copiedDocument = await this.requestJson<DocumentResource>(
      "docs.composeFromPlan.getDocument",
      `${DOCS_API_ROOT}/documents/${encodeURIComponent(targetDocumentId)}`
    );
    const endIndex = extractDocumentEndIndex(copiedDocument);
    const composed = buildComposedDocument(input.plan);

    const requests: Array<Record<string, unknown>> = [];
    if (input.clearTemplateContent && endIndex > 2) {
      requests.push({
        deleteContentRange: {
          range: {
            startIndex: 1,
            endIndex: endIndex - 1
          }
        }
      });
    }

    if (composed.text.length > 0) {
      const globalStart = 1;
      const globalEnd = globalStart + composed.text.length;
      requests.push({
        insertText: {
          location: { index: globalStart },
          text: composed.text
        }
      });
      requests.push({
        updateTextStyle: {
          range: { startIndex: globalStart, endIndex: globalEnd },
          textStyle: {
            weightedFontFamily: { fontFamily: input.plan.style.fontFamily },
            fontSize: { magnitude: input.plan.style.fontSizePt, unit: "PT" }
          },
          fields: "weightedFontFamily,fontSize"
        }
      });
      if (input.plan.style.compactSpacing) {
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: globalStart, endIndex: globalEnd },
            paragraphStyle: {
              lineSpacing: 115,
              spaceAbove: { magnitude: 0, unit: "PT" },
              spaceBelow: { magnitude: 0, unit: "PT" }
            },
            fields: "lineSpacing,spaceAbove,spaceBelow"
          }
        });
      }

      if (composed.ranges.nameRange) {
        requests.push({
          updateTextStyle: {
            range: toTextRange(composed.ranges.nameRange),
            textStyle: {
              bold: true,
              fontSize: { magnitude: input.plan.style.fontSizePt + 4, unit: "PT" }
            },
            fields: "bold,fontSize"
          }
        });
        requests.push({
          updateParagraphStyle: {
            range: toParagraphRange(composed.ranges.nameRange),
            paragraphStyle: { alignment: "CENTER" },
            fields: "alignment"
          }
        });
      }

      for (const centered of [composed.ranges.titleRange, composed.ranges.contactRange]) {
        if (!centered) continue;
        requests.push({
          updateParagraphStyle: {
            range: toParagraphRange(centered),
            paragraphStyle: { alignment: "CENTER" },
            fields: "alignment"
          }
        });
      }

      for (const heading of composed.ranges.headingRanges) {
        requests.push({
          updateTextStyle: {
            range: toTextRange(heading),
            textStyle: {
              bold: true,
              fontSize: { magnitude: input.plan.style.fontSizePt + 1, unit: "PT" }
            },
            fields: "bold,fontSize"
          }
        });
      }

      for (const roleRange of composed.ranges.roleRanges) {
        requests.push({
          updateTextStyle: {
            range: toTextRange(roleRange),
            textStyle: { bold: true },
            fields: "bold"
          }
        });
      }

      for (const rightAligned of composed.ranges.rightAlignedRanges) {
        requests.push({
          updateParagraphStyle: {
            range: toParagraphRange(rightAligned),
            paragraphStyle: { alignment: input.plan.style.dateAlignment === "right" ? "END" : "START" },
            fields: "alignment"
          }
        });
      }

      for (const bulletRange of composed.ranges.bulletRanges) {
        requests.push({
          createParagraphBullets: {
            range: toParagraphRange(bulletRange),
            bulletPreset: "BULLET_DISC_CIRCLE_SQUARE"
          }
        });
      }
    }

    if (requests.length > 0) {
      await this.performBatchUpdate(targetDocumentId, requests, undefined, "docs.composeFromPlan.batchUpdate");
    }

    return {
      templateDocumentId,
      documentId: targetDocumentId,
      documentUrl: toDocumentUrl(targetDocumentId),
      folderId,
      title: targetTitle,
      composeStats: composed.stats
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

type IndexRange = { start: number; end: number };

interface ComposedRanges {
  nameRange?: IndexRange;
  titleRange?: IndexRange;
  contactRange?: IndexRange;
  headingRanges: IndexRange[];
  roleRanges: IndexRange[];
  rightAlignedRanges: IndexRange[];
  bulletRanges: IndexRange[];
}

function extractDocumentEndIndex(document: DocumentResource): number {
  const body = document.body as { content?: Array<{ endIndex?: number }> } | undefined;
  if (!body || !Array.isArray(body.content) || body.content.length === 0) {
    return 2;
  }
  const maxEnd = body.content.reduce((acc, item) => {
    const end = typeof item.endIndex === "number" ? item.endIndex : 0;
    return Math.max(acc, end);
  }, 0);
  return Math.max(maxEnd, 2);
}

function toTextRange(range: IndexRange): { startIndex: number; endIndex: number } {
  return { startIndex: range.start, endIndex: range.end };
}

function toParagraphRange(range: IndexRange): { startIndex: number; endIndex: number } {
  return { startIndex: range.start, endIndex: range.end + 1 };
}

function headingText(value: string, mode: "UPPERCASE" | "TITLE_CASE"): string {
  const cleaned = value.trim();
  return mode === "TITLE_CASE"
    ? cleaned
        .toLowerCase()
        .split(" ")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    : cleaned.toUpperCase();
}

function cleanText(value: string | undefined): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\u00A0/g, " ")
    .trim();
}

function buildComposedDocument(plan: ComposePlan): {
  text: string;
  ranges: ComposedRanges;
  stats: Record<string, unknown>;
} {
  let buffer = "";
  let cursor = 1;
  const ranges: ComposedRanges = {
    headingRanges: [],
    roleRanges: [],
    rightAlignedRanges: [],
    bulletRanges: []
  };
  let paragraphCount = 0;
  let bulletCount = 0;

  const appendLine = (text: string): IndexRange | undefined => {
    const cleaned = cleanText(text);
    if (!cleaned) {
      return undefined;
    }
    const start = cursor;
    buffer += `${cleaned}\n`;
    cursor += cleaned.length + 1;
    paragraphCount += 1;
    return { start, end: start + cleaned.length };
  };

  const appendBlankLine = (): void => {
    buffer += "\n";
    cursor += 1;
  };

  const nameRange = appendLine(plan.header.name);
  if (nameRange) ranges.nameRange = nameRange;
  const titleRange = appendLine(plan.header.title ?? "");
  if (titleRange) ranges.titleRange = titleRange;
  const contactRange = appendLine(plan.header.contactLine ?? "");
  if (contactRange) ranges.contactRange = contactRange;
  appendBlankLine();

  for (let sectionIndex = 0; sectionIndex < plan.sections.length; sectionIndex += 1) {
    const section = plan.sections[sectionIndex];
    const headingRange = appendLine(headingText(section.heading, plan.style.headingCase));
    if (headingRange) {
      ranges.headingRanges.push(headingRange);
    }

    for (const block of section.blocks) {
      if (block.type === "paragraph") {
        appendLine(block.text);
        continue;
      }
      if (block.type === "bullets") {
        for (const item of block.items) {
          const bulletRange = appendLine(item);
          if (bulletRange) {
            ranges.bulletRanges.push(bulletRange);
            bulletCount += 1;
          }
        }
        continue;
      }

      const roleLine = appendLine(`${block.role} - ${block.company}`);
      if (roleLine) {
        ranges.roleRanges.push(roleLine);
      }
      const dates = appendLine(block.dates);
      if (dates) {
        ranges.rightAlignedRanges.push(dates);
      }
      if (block.company_description) {
        appendLine(block.company_description);
      }
      if (block.project) {
        appendLine(`Project - ${block.project}`);
      }
      if (block.tech_stack) {
        appendLine(`Tech Stack - ${block.tech_stack}`);
      }
      for (const item of block.bullets) {
        const bulletRange = appendLine(item);
        if (bulletRange) {
          ranges.bulletRanges.push(bulletRange);
          bulletCount += 1;
        }
      }
      appendBlankLine();
    }

    if (sectionIndex < plan.sections.length - 1) {
      appendBlankLine();
    }
  }

  return {
    text: buffer,
    ranges,
    stats: {
      paragraphs: paragraphCount,
      bullets: bulletCount,
      sections: plan.sections.length,
      characters: buffer.length
    }
  };
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

function hasDocumentReference(reference: DocumentReferenceInput): boolean {
  return Boolean(reference.id || reference.url || reference.name || reference.path);
}
