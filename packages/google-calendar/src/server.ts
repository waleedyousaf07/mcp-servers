import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./lib/constants.js";
import { GoogleCalendarClient } from "./lib/calendar-client.js";
import { isToolExecutionError, ToolExecutionError } from "./lib/errors.js";
import { createLogger } from "./lib/logger.js";
import {
  OAuthSession,
  isKeytarEnabled,
  loadOAuthCredentialsFromEnvironment
} from "./lib/oauth.js";
import { TokenStore } from "./lib/token-store.js";
import {
  createEventInputSchema,
  createEventInputShape,
  deleteEventInputSchema,
  deleteEventInputShape,
  getEventInputSchema,
  getEventInputShape,
  listCalendarsInputSchema,
  listCalendarsInputShape,
  listEventsInputSchema,
  listEventsInputShape,
  updateEventInputSchema,
  updateEventInputShape
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
  const calendar = new GoogleCalendarClient({
    auth,
    logger
  });

  const server = new McpServer({
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION
  });

  server.tool("calendar.listCalendars", listCalendarsInputShape, async (rawArgs) =>
    runTool("calendar.listCalendars", logger, async () => {
      const args = listCalendarsInputSchema.parse(rawArgs);
      return calendar.listCalendars(args);
    })
  );

  server.tool("calendar.listEvents", listEventsInputShape, async (rawArgs) =>
    runTool("calendar.listEvents", logger, async () => {
      const args = listEventsInputSchema.parse(rawArgs);
      return calendar.listEvents(args);
    })
  );

  server.tool("calendar.getEvent", getEventInputShape, async (rawArgs) =>
    runTool("calendar.getEvent", logger, async () => {
      const args = getEventInputSchema.parse(rawArgs);
      return calendar.getEvent(args.calendarId, args.eventId);
    })
  );

  server.tool("calendar.createEvent", createEventInputShape, async (rawArgs) =>
    runTool("calendar.createEvent", logger, async () => {
      const args = createEventInputSchema.parse(rawArgs);
      return calendar.createEvent(args);
    })
  );

  server.tool("calendar.updateEvent", updateEventInputShape, async (rawArgs) =>
    runTool("calendar.updateEvent", logger, async () => {
      const args = updateEventInputSchema.parse(rawArgs);
      return calendar.updateEvent(args);
    })
  );

  server.tool("calendar.deleteEvent", deleteEventInputShape, async (rawArgs) =>
    runTool("calendar.deleteEvent", logger, async () => {
      const args = deleteEventInputSchema.parse(rawArgs);
      return calendar.deleteEvent(args.calendarId, args.eventId, args.sendUpdates);
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
