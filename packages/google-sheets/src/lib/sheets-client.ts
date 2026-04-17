import {
  DRIVE_API_ROOT,
  RESOLVER_CANDIDATE_MAX_RESULTS,
  SHEETS_API_ROOT,
  SPREADSHEET_SEARCH_DEFAULT_MAX_RESULTS
} from "./constants.js";
import { ToolExecutionError, mapGoogleApiError } from "./errors.js";
import type { Logger } from "./logger.js";
import type { OAuthSession } from "./oauth.js";
import type { SpreadsheetReferenceInput } from "./tools.js";
import { encodeQuery, sleep } from "./utils.js";

const SHEETS_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
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

interface SpreadsheetResource {
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  properties?: {
    title?: string;
  };
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
      index?: number;
    };
  }>;
  [key: string]: unknown;
}

interface ValueRangeResource {
  range?: string;
  majorDimension?: "ROWS" | "COLUMNS";
  values?: unknown[][];
}

interface BatchGetValuesResponse {
  spreadsheetId?: string;
  valueRanges?: ValueRangeResource[];
}

interface UpdateValuesResponse {
  spreadsheetId?: string;
  updatedRange?: string;
  updatedRows?: number;
  updatedColumns?: number;
  updatedCells?: number;
  updatedData?: ValueRangeResource;
}

interface AppendValuesResponse {
  spreadsheetId?: string;
  tableRange?: string;
  updates?: UpdateValuesResponse;
}

interface ClearValuesResponse {
  spreadsheetId?: string;
  clearedRange?: string;
}

interface BatchUpdateResponse {
  spreadsheetId?: string;
  replies?: unknown[];
  updatedSpreadsheet?: SpreadsheetResource;
}

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

export class GoogleSheetsClient {
  private readonly auth: OAuthSession;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { auth: OAuthSession; logger: Logger; fetchImpl?: typeof fetch }) {
    this.auth = options.auth;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async searchSpreadsheets(input: {
    query?: string;
    maxResults: number;
    pageToken?: string;
    includeTrashed: boolean;
  }): Promise<{
    spreadsheets: Array<{
      spreadsheetId: string;
      name?: string;
      mimeType?: string;
      modifiedTime?: string;
      createdTime?: string;
      webViewLink?: string;
      parents?: string[];
    }>;
    nextPageToken?: string;
  }> {
    const queryParts = [`mimeType='${SHEETS_MIME_TYPE}'`];
    if (!input.includeTrashed) {
      queryParts.push("trashed=false");
    }
    if (input.query) {
      queryParts.push(`name contains '${escapeDriveQueryValue(input.query)}'`);
    }

    const response = await this.listDriveFiles({
      operation: "sheets.searchSpreadsheets",
      q: queryParts.join(" and "),
      pageSize: input.maxResults || SPREADSHEET_SEARCH_DEFAULT_MAX_RESULTS,
      pageToken: input.pageToken
    });

    return {
      spreadsheets: (response.files ?? [])
        .filter((item): item is DriveFileResource & { id: string } => Boolean(item.id))
        .map((item) => ({
          spreadsheetId: item.id,
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

  async getSpreadsheet(
    reference: SpreadsheetReferenceInput,
    input: {
      includeGridData: boolean;
      ranges?: string[];
    }
  ): Promise<{
    spreadsheetId: string;
    spreadsheet: SpreadsheetResource;
  }> {
    const spreadsheetId = await this.resolveSpreadsheetId(reference, "sheets.getSpreadsheet");
    const url = withQuery(
      `${SHEETS_API_ROOT}/spreadsheets/${encodeURIComponent(spreadsheetId)}`,
      {
        includeGridData: input.includeGridData
      },
      input.ranges ? { ranges: input.ranges } : undefined
    );
    const spreadsheet = await this.requestJson<SpreadsheetResource>("sheets.getSpreadsheet", url);

    return {
      spreadsheetId,
      spreadsheet
    };
  }

  async createSpreadsheet(input: {
    title: string;
    sheetTitle?: string;
  }): Promise<{
    spreadsheetId: string;
    spreadsheetUrl?: string;
    title?: string;
    sheets: Array<{
      sheetId?: number;
      title?: string;
      index?: number;
    }>;
  }> {
    const spreadsheet = await this.requestJson<SpreadsheetResource>(
      "sheets.createSpreadsheet",
      `${SHEETS_API_ROOT}/spreadsheets`,
      {
        method: "POST",
        body: JSON.stringify({
          properties: {
            title: input.title
          },
          ...(input.sheetTitle
            ? {
                sheets: [
                  {
                    properties: {
                      title: input.sheetTitle
                    }
                  }
                ]
              }
            : {})
        })
      }
    );

    if (!spreadsheet.spreadsheetId) {
      throw new ToolExecutionError("Google returned a spreadsheet response without spreadsheetId.", {
        kind: "api_error"
      });
    }

    return {
      spreadsheetId: spreadsheet.spreadsheetId,
      spreadsheetUrl: spreadsheet.spreadsheetUrl,
      title: spreadsheet.properties?.title,
      sheets: (spreadsheet.sheets ?? []).map((sheet) => ({
        sheetId: sheet.properties?.sheetId,
        title: sheet.properties?.title,
        index: sheet.properties?.index
      }))
    };
  }

  async getValues(
    reference: SpreadsheetReferenceInput,
    input: {
      range: string;
      majorDimension: "ROWS" | "COLUMNS";
      valueRenderOption: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
      dateTimeRenderOption: "SERIAL_NUMBER" | "FORMATTED_STRING";
    }
  ): Promise<{
    spreadsheetId: string;
    range?: string;
    majorDimension?: string;
    values?: unknown[][];
  }> {
    const spreadsheetId = await this.resolveSpreadsheetId(reference, "sheets.getValues");
    const url = `${SHEETS_API_ROOT}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      input.range
    )}${encodeQuery({
      majorDimension: input.majorDimension,
      valueRenderOption: input.valueRenderOption,
      dateTimeRenderOption: input.dateTimeRenderOption
    })}`;
    const response = await this.requestJson<ValueRangeResource>("sheets.getValues", url);

    return {
      spreadsheetId,
      range: response.range,
      majorDimension: response.majorDimension,
      values: response.values
    };
  }

  async batchGetValues(
    reference: SpreadsheetReferenceInput,
    input: {
      ranges: string[];
      majorDimension: "ROWS" | "COLUMNS";
      valueRenderOption: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
      dateTimeRenderOption: "SERIAL_NUMBER" | "FORMATTED_STRING";
    }
  ): Promise<{
    spreadsheetId: string;
    valueRanges: ValueRangeResource[];
  }> {
    const spreadsheetId = await this.resolveSpreadsheetId(reference, "sheets.batchGetValues");
    const url = withQuery(
      `${SHEETS_API_ROOT}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet`,
      {
        majorDimension: input.majorDimension,
        valueRenderOption: input.valueRenderOption,
        dateTimeRenderOption: input.dateTimeRenderOption
      },
      {
        ranges: input.ranges
      }
    );
    const response = await this.requestJson<BatchGetValuesResponse>("sheets.batchGetValues", url);

    return {
      spreadsheetId,
      valueRanges: response.valueRanges ?? []
    };
  }

  async updateValues(
    reference: SpreadsheetReferenceInput,
    input: {
      range: string;
      values: unknown[][];
      majorDimension: "ROWS" | "COLUMNS";
      valueInputOption: "RAW" | "USER_ENTERED";
      includeValuesInResponse: boolean;
      responseValueRenderOption: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
      responseDateTimeRenderOption: "SERIAL_NUMBER" | "FORMATTED_STRING";
    }
  ): Promise<{
    spreadsheetId: string;
    updatedRange?: string;
    updatedRows?: number;
    updatedColumns?: number;
    updatedCells?: number;
    updatedData?: ValueRangeResource;
  }> {
    const spreadsheetId = await this.resolveSpreadsheetId(reference, "sheets.updateValues");
    const url = `${SHEETS_API_ROOT}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      input.range
    )}${encodeQuery({
      valueInputOption: input.valueInputOption,
      includeValuesInResponse: input.includeValuesInResponse,
      responseValueRenderOption: input.responseValueRenderOption,
      responseDateTimeRenderOption: input.responseDateTimeRenderOption
    })}`;
    const response = await this.requestJson<UpdateValuesResponse>("sheets.updateValues", url, {
      method: "PUT",
      body: JSON.stringify({
        majorDimension: input.majorDimension,
        values: input.values
      })
    });

    return {
      spreadsheetId,
      updatedRange: response.updatedRange,
      updatedRows: response.updatedRows,
      updatedColumns: response.updatedColumns,
      updatedCells: response.updatedCells,
      updatedData: response.updatedData
    };
  }

  async appendValues(
    reference: SpreadsheetReferenceInput,
    input: {
      range: string;
      values: unknown[][];
      majorDimension: "ROWS" | "COLUMNS";
      valueInputOption: "RAW" | "USER_ENTERED";
      insertDataOption: "OVERWRITE" | "INSERT_ROWS";
      includeValuesInResponse: boolean;
      responseValueRenderOption: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
      responseDateTimeRenderOption: "SERIAL_NUMBER" | "FORMATTED_STRING";
    }
  ): Promise<{
    spreadsheetId: string;
    tableRange?: string;
    updates?: UpdateValuesResponse;
  }> {
    const spreadsheetId = await this.resolveSpreadsheetId(reference, "sheets.appendValues");
    const url = `${SHEETS_API_ROOT}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      input.range
    )}:append${encodeQuery({
      valueInputOption: input.valueInputOption,
      insertDataOption: input.insertDataOption,
      includeValuesInResponse: input.includeValuesInResponse,
      responseValueRenderOption: input.responseValueRenderOption,
      responseDateTimeRenderOption: input.responseDateTimeRenderOption
    })}`;
    const response = await this.requestJson<AppendValuesResponse>("sheets.appendValues", url, {
      method: "POST",
      body: JSON.stringify({
        majorDimension: input.majorDimension,
        values: input.values
      })
    });

    return {
      spreadsheetId,
      tableRange: response.tableRange,
      updates: response.updates
    };
  }

  async clearValues(
    reference: SpreadsheetReferenceInput,
    input: { range: string }
  ): Promise<{
    spreadsheetId: string;
    clearedRange?: string;
  }> {
    const spreadsheetId = await this.resolveSpreadsheetId(reference, "sheets.clearValues");
    const url = `${SHEETS_API_ROOT}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      input.range
    )}:clear`;
    const response = await this.requestJson<ClearValuesResponse>("sheets.clearValues", url, {
      method: "POST",
      body: JSON.stringify({})
    });

    return {
      spreadsheetId,
      clearedRange: response.clearedRange
    };
  }

  async batchUpdate(
    reference: SpreadsheetReferenceInput,
    input: {
      requests: Array<Record<string, unknown>>;
      includeSpreadsheetInResponse: boolean;
      responseRanges?: string[];
      responseIncludeGridData: boolean;
    }
  ): Promise<{
    spreadsheetId: string;
    replies?: unknown[];
    updatedSpreadsheet?: SpreadsheetResource;
  }> {
    const spreadsheetId = await this.resolveSpreadsheetId(reference, "sheets.batchUpdate");
    const url = `${SHEETS_API_ROOT}/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
    const response = await this.requestJson<BatchUpdateResponse>("sheets.batchUpdate", url, {
      method: "POST",
      body: JSON.stringify({
        requests: input.requests,
        includeSpreadsheetInResponse: input.includeSpreadsheetInResponse,
        responseRanges: input.responseRanges,
        responseIncludeGridData: input.responseIncludeGridData
      })
    });

    return {
      spreadsheetId,
      replies: response.replies,
      updatedSpreadsheet: response.updatedSpreadsheet
    };
  }

  private async resolveSpreadsheetId(
    reference: SpreadsheetReferenceInput,
    operation: string
  ): Promise<string> {
    if (reference.id) {
      return reference.id;
    }

    if (reference.url) {
      const spreadsheetId = parseSpreadsheetIdFromUrl(reference.url);
      if (!spreadsheetId) {
        throw new ToolExecutionError("Unable to extract a Google spreadsheet id from url.", {
          kind: "tool_error",
          details: {
            operation,
            referenceType: "url",
            referenceValue: reference.url
          }
        });
      }
      return spreadsheetId;
    }

    if (reference.name) {
      return this.resolveByName(reference.name, operation);
    }

    return this.resolveByPath(reference.path!, operation);
  }

  private async resolveByName(name: string, operation: string): Promise<string> {
    const response = await this.listDriveFiles({
      operation,
      q: `mimeType='${SHEETS_MIME_TYPE}' and trashed=false and name='${escapeDriveQueryValue(name)}'`,
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
      const mimeType = isLast ? SHEETS_MIME_TYPE : FOLDER_MIME_TYPE;
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

    throw new ToolExecutionError("Unable to resolve spreadsheet from path.", {
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
      this.logger.info("sheets_request_complete", {
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
    throw new ToolExecutionError("No spreadsheet matched the provided reference.", {
      kind: "not_found",
      details: {
        ...details,
        candidates: []
      }
    });
  }

  throw new ToolExecutionError(
    "Reference matched multiple spreadsheets. Provide id, url, or path.",
    {
      kind: "tool_error",
      details: {
        ...details,
        candidates: normalized
      }
    }
  );
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

function withQuery(
  base: string,
  singular: Record<string, string | number | boolean | undefined>,
  multi?: Record<string, string[] | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(singular)) {
    if (value === undefined) {
      continue;
    }
    search.set(key, String(value));
  }

  for (const [key, values] of Object.entries(multi ?? {})) {
    for (const value of values ?? []) {
      search.append(key, value);
    }
  }

  const serialized = search.toString();
  return serialized ? `${base}?${serialized}` : base;
}

export function parseSpreadsheetIdFromUrl(url: string): string | undefined {
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

  const patterns = [/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/, /\/file\/d\/([a-zA-Z0-9_-]+)/];
  for (const pattern of patterns) {
    const match = parsed.pathname.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}
