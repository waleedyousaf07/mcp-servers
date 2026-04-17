import { describe, expect, it, vi } from "vitest";
import { GoogleSheetsClient, parseSpreadsheetIdFromUrl } from "../src/lib/sheets-client.js";
import { ToolExecutionError } from "../src/lib/errors.js";
import type { Logger } from "../src/lib/logger.js";
import type { OAuthSession } from "../src/lib/oauth.js";

function makeClient(responses: unknown[]): GoogleSheetsClient {
  let index = 0;
  const fetchImpl: typeof fetch = vi.fn(async () => {
    const payload = responses[index] ?? {};
    index += 1;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    });
  }) as unknown as typeof fetch;

  const auth = {
    getAccessToken: vi.fn(async () => "token")
  } as unknown as OAuthSession;

  const logger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };

  return new GoogleSheetsClient({
    auth,
    logger,
    fetchImpl
  });
}

describe("resolver", () => {
  it("extracts a spreadsheet id from a sheets URL", () => {
    expect(parseSpreadsheetIdFromUrl("https://docs.google.com/spreadsheets/d/abc123_xyz/edit")).toBe(
      "abc123_xyz"
    );
  });

  it("returns deterministic not_found details for missing name resolution", async () => {
    const client = makeClient([
      {
        files: []
      }
    ]);

    await expect(client.getSpreadsheet({ name: "Missing Sheet" }, { includeGridData: false })).rejects.toMatchObject({
      kind: "not_found",
      details: {
        referenceType: "name",
        referenceValue: "Missing Sheet",
        candidates: []
      }
    } satisfies Partial<ToolExecutionError>);
  });

  it("returns deterministic ambiguous details for path resolution", async () => {
    const client = makeClient([
      {
        files: [
          { id: "folder-1", name: "Finance", mimeType: "application/vnd.google-apps.folder" },
          { id: "folder-2", name: "Finance", mimeType: "application/vnd.google-apps.folder" }
        ]
      }
    ]);

    await expect(
      client.getSpreadsheet({ path: "Finance/Budget" }, { includeGridData: false })
    ).rejects.toMatchObject({
      kind: "tool_error",
      details: {
        referenceType: "path",
        referenceValue: "Finance/Budget",
        candidates: [
          { fileId: "folder-1", name: "Finance" },
          { fileId: "folder-2", name: "Finance" }
        ]
      }
    } satisfies Partial<ToolExecutionError>);
  });
});
