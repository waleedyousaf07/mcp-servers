import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./lib/constants.js";
import { GoogleDocsClient } from "./lib/docs-client.js";
import { isToolExecutionError, ToolExecutionError } from "./lib/errors.js";
import { createLogger } from "./lib/logger.js";
import {
  OAuthSession,
  isKeytarEnabled,
  loadOAuthCredentialsFromEnvironment
} from "./lib/oauth.js";
import { TokenStore } from "./lib/token-store.js";
import {
  batchUpdateInputSchema,
  batchUpdateInputShape,
  composeFromPlanInputSchema,
  composeFromPlanInputShape,
  copyTemplateToFolderInputSchema,
  copyTemplateToFolderInputShape,
  createDocumentInputSchema,
  createDocumentInputShape,
  getDocumentInputSchema,
  getDocumentInputShape,
  insertTextInputSchema,
  insertTextInputShape,
  replaceAllTextInputSchema,
  replaceAllTextInputShape,
  searchDocumentsInputSchema,
  searchDocumentsInputShape
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
  const docs = new GoogleDocsClient({
    auth,
    logger
  });

  const server = new McpServer({
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION
  });

  server.tool("docs.searchDocuments", searchDocumentsInputShape, async (rawArgs) =>
    runTool("docs.searchDocuments", logger, async () => {
      const args = searchDocumentsInputSchema.parse(rawArgs);
      return docs.searchDocuments(args);
    })
  );

  server.tool("docs.getDocument", getDocumentInputShape, async (rawArgs) =>
    runTool("docs.getDocument", logger, async () => {
      const args = getDocumentInputSchema.parse(rawArgs);
      return docs.getDocument(args, args.includeTabsContent);
    })
  );

  server.tool("docs.createDocument", createDocumentInputShape, async (rawArgs) =>
    runTool("docs.createDocument", logger, async () => {
      const args = createDocumentInputSchema.parse(rawArgs);
      return docs.createDocument(args);
    })
  );

  server.tool("docs.insertText", insertTextInputShape, async (rawArgs) =>
    runTool("docs.insertText", logger, async () => {
      const args = insertTextInputSchema.parse(rawArgs);
      return docs.insertText(args, {
        text: args.text,
        index: args.index
      });
    })
  );

  server.tool("docs.replaceAllText", replaceAllTextInputShape, async (rawArgs) =>
    runTool("docs.replaceAllText", logger, async () => {
      const args = replaceAllTextInputSchema.parse(rawArgs);
      return docs.replaceAllText(args, {
        searchText: args.searchText,
        replaceText: args.replaceText,
        matchCase: args.matchCase
      });
    })
  );

  server.tool("docs.batchUpdate", batchUpdateInputShape, async (rawArgs) =>
    runTool("docs.batchUpdate", logger, async () => {
      const args = batchUpdateInputSchema.parse(rawArgs);
      return docs.batchUpdate(args, {
        requests: args.requests,
        writeControl: args.writeControl
      });
    })
  );

  server.tool("docs.copyTemplateToFolder", copyTemplateToFolderInputShape, async (rawArgs) =>
    runTool("docs.copyTemplateToFolder", logger, async () => {
      const args = copyTemplateToFolderInputSchema.parse(rawArgs);
      return docs.copyTemplateToFolder(args, {
        folderId: args.folderId,
        folderUrl: args.folderUrl,
        title: args.title,
        replacements: args.replacements,
        strictPlaceholderCheck: args.strictPlaceholderCheck,
        matchCase: args.matchCase
      });
    })
  );

  server.tool("docs.composeFromPlan", composeFromPlanInputShape, async (rawArgs) =>
    runTool("docs.composeFromPlan", logger, async () => {
      const args = composeFromPlanInputSchema.parse(rawArgs);
      return docs.composeFromPlan(args, {
        folderId: args.folderId,
        folderUrl: args.folderUrl,
        title: args.title,
        plan: args.plan,
        clearTemplateContent: args.clearTemplateContent
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
