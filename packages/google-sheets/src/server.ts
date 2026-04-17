import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./lib/constants.js";
import { isToolExecutionError, ToolExecutionError } from "./lib/errors.js";
import { createLogger } from "./lib/logger.js";
import {
  OAuthSession,
  isKeytarEnabled,
  loadOAuthCredentialsFromEnvironment
} from "./lib/oauth.js";
import { GoogleSheetsClient } from "./lib/sheets-client.js";
import { TokenStore } from "./lib/token-store.js";
import {
  appendValuesInputSchema,
  appendValuesInputShape,
  batchGetValuesInputSchema,
  batchGetValuesInputShape,
  batchUpdateInputSchema,
  batchUpdateInputShape,
  clearValuesInputSchema,
  clearValuesInputShape,
  createSpreadsheetInputSchema,
  createSpreadsheetInputShape,
  getSpreadsheetInputSchema,
  getSpreadsheetInputShape,
  getValuesInputSchema,
  getValuesInputShape,
  searchSpreadsheetsInputSchema,
  searchSpreadsheetsInputShape,
  updateValuesInputSchema,
  updateValuesInputShape
} from "./lib/tools.js";
import { randomId } from "./lib/utils.js";

export async function runServer(): Promise<void> {
  const logger = createLogger();
  const tokenStore = new TokenStore({
    logger,
    useKeytar: isKeytarEnabled()
  });

  const credentials = await loadOAuthCredentialsFromEnvironment();
  const auth = new OAuthSession({
    credentials,
    logger,
    tokenStore
  });
  const sheets = new GoogleSheetsClient({
    auth,
    logger
  });

  const server = new McpServer({
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION
  });

  server.tool("sheets.searchSpreadsheets", searchSpreadsheetsInputShape, async (rawArgs) =>
    runTool("sheets.searchSpreadsheets", logger, async () => {
      const args = searchSpreadsheetsInputSchema.parse(rawArgs);
      return sheets.searchSpreadsheets(args);
    })
  );

  server.tool("sheets.getSpreadsheet", getSpreadsheetInputShape, async (rawArgs) =>
    runTool("sheets.getSpreadsheet", logger, async () => {
      const args = getSpreadsheetInputSchema.parse(rawArgs);
      return sheets.getSpreadsheet(args, {
        includeGridData: args.includeGridData,
        ranges: args.ranges
      });
    })
  );

  server.tool("sheets.createSpreadsheet", createSpreadsheetInputShape, async (rawArgs) =>
    runTool("sheets.createSpreadsheet", logger, async () => {
      const args = createSpreadsheetInputSchema.parse(rawArgs);
      return sheets.createSpreadsheet(args);
    })
  );

  server.tool("sheets.getValues", getValuesInputShape, async (rawArgs) =>
    runTool("sheets.getValues", logger, async () => {
      const args = getValuesInputSchema.parse(rawArgs);
      return sheets.getValues(args, {
        range: args.range,
        majorDimension: args.majorDimension,
        valueRenderOption: args.valueRenderOption,
        dateTimeRenderOption: args.dateTimeRenderOption
      });
    })
  );

  server.tool("sheets.batchGetValues", batchGetValuesInputShape, async (rawArgs) =>
    runTool("sheets.batchGetValues", logger, async () => {
      const args = batchGetValuesInputSchema.parse(rawArgs);
      return sheets.batchGetValues(args, {
        ranges: args.ranges,
        majorDimension: args.majorDimension,
        valueRenderOption: args.valueRenderOption,
        dateTimeRenderOption: args.dateTimeRenderOption
      });
    })
  );

  server.tool("sheets.updateValues", updateValuesInputShape, async (rawArgs) =>
    runTool("sheets.updateValues", logger, async () => {
      const args = updateValuesInputSchema.parse(rawArgs);
      return sheets.updateValues(args, {
        range: args.range,
        values: args.values,
        majorDimension: args.majorDimension,
        valueInputOption: args.valueInputOption,
        includeValuesInResponse: args.includeValuesInResponse,
        responseValueRenderOption: args.responseValueRenderOption,
        responseDateTimeRenderOption: args.responseDateTimeRenderOption
      });
    })
  );

  server.tool("sheets.appendValues", appendValuesInputShape, async (rawArgs) =>
    runTool("sheets.appendValues", logger, async () => {
      const args = appendValuesInputSchema.parse(rawArgs);
      return sheets.appendValues(args, {
        range: args.range,
        values: args.values,
        majorDimension: args.majorDimension,
        valueInputOption: args.valueInputOption,
        insertDataOption: args.insertDataOption,
        includeValuesInResponse: args.includeValuesInResponse,
        responseValueRenderOption: args.responseValueRenderOption,
        responseDateTimeRenderOption: args.responseDateTimeRenderOption
      });
    })
  );

  server.tool("sheets.clearValues", clearValuesInputShape, async (rawArgs) =>
    runTool("sheets.clearValues", logger, async () => {
      const args = clearValuesInputSchema.parse(rawArgs);
      return sheets.clearValues(args, {
        range: args.range
      });
    })
  );

  server.tool("sheets.batchUpdate", batchUpdateInputShape, async (rawArgs) =>
    runTool("sheets.batchUpdate", logger, async () => {
      const args = batchUpdateInputSchema.parse(rawArgs);
      return sheets.batchUpdate(args, {
        requests: args.requests,
        includeSpreadsheetInResponse: args.includeSpreadsheetInResponse,
        responseRanges: args.responseRanges,
        responseIncludeGridData: args.responseIncludeGridData
      });
    })
  );

  logger.info("server_starting", {
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    scopes: auth.scopeList
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runTool<T extends object>(
  toolName: string,
  logger: ReturnType<typeof createLogger>,
  action: () => Promise<T>
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}> {
  const correlationId = randomId();
  const started = Date.now();

  try {
    const result = await action();
    logger.info("tool_success", {
      toolName,
      correlationId,
      durationMs: Date.now() - started
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result)
        }
      ],
      structuredContent: result as Record<string, unknown>
    };
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error("tool_failure", {
      toolName,
      correlationId,
      durationMs: Date.now() - started,
      errorKind: normalized.kind,
      status: normalized.status
    });
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: normalized.message
        }
      ],
      structuredContent: {
        error: {
          kind: normalized.kind,
          message: normalized.message,
          status: normalized.status,
          details: normalized.details
        }
      }
    };
  }
}

function normalizeError(error: unknown): ToolExecutionError {
  if (isToolExecutionError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new ToolExecutionError(error.message, {
      kind: "tool_error",
      cause: error
    });
  }

  return new ToolExecutionError("Unknown tool failure.", {
    kind: "tool_error"
  });
}
