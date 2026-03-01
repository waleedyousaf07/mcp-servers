import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./lib/constants.js";
import { isToolExecutionError, ToolExecutionError } from "./lib/errors.js";
import { GmailClient } from "./lib/gmail-client.js";
import { createLogger } from "./lib/logger.js";
import {
  OAuthSession,
  isKeytarEnabled,
  loadOAuthCredentialsFromEnvironment
} from "./lib/oauth.js";
import { TokenStore } from "./lib/token-store.js";
import {
  createDraftInputSchema,
  createDraftInputShape,
  getMessageInputSchema,
  getMessageInputShape,
  getThreadInputSchema,
  getThreadInputShape,
  listLabelsInputShape,
  searchInputSchema,
  searchInputShape,
  sendMessageInputSchema,
  sendMessageInputShape
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
  const gmail = new GmailClient({
    auth,
    logger
  });

  const server = new McpServer({
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION
  });

  server.tool("gmail.search", searchInputShape, async (rawArgs) =>
    runTool("gmail.search", logger, async () => {
      const args = searchInputSchema.parse(rawArgs);
      return gmail.searchThreads(args);
    })
  );

  server.tool("gmail.getThread", getThreadInputShape, async (rawArgs) =>
    runTool("gmail.getThread", logger, async () => {
      const args = getThreadInputSchema.parse(rawArgs);
      return gmail.getThread(args.threadId, args.includeBodies, args.bodyFormat, args.maxMessages);
    })
  );

  server.tool("gmail.getMessage", getMessageInputShape, async (rawArgs) =>
    runTool("gmail.getMessage", logger, async () => {
      const args = getMessageInputSchema.parse(rawArgs);
      return gmail.getMessage(args.messageId, args.includeBody, args.bodyFormat);
    })
  );

  server.tool("gmail.listLabels", listLabelsInputShape, async () =>
    runTool("gmail.listLabels", logger, async () => gmail.listLabels())
  );

  server.tool("gmail.createDraft", createDraftInputShape, async (rawArgs) =>
    runTool("gmail.createDraft", logger, async () => {
      const args = createDraftInputSchema.parse(rawArgs);
      return gmail.createDraft(args);
    })
  );

  server.tool("gmail.sendMessage", sendMessageInputShape, async (rawArgs) =>
    runTool("gmail.sendMessage", logger, async () => {
      const args = sendMessageInputSchema.parse(rawArgs);
      if (args.draftId) {
        return gmail.sendDraft(args.draftId);
      }

      return gmail.sendMessage({
        to: args.to!,
        cc: args.cc,
        bcc: args.bcc,
        subject: args.subject!,
        body: args.body!,
        replyToMessageId: args.replyToMessageId,
        threadId: args.threadId
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
