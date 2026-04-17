import { describe, expect, it, vi } from "vitest";
import { GoogleDocsClient, parseDocumentIdFromUrl } from "../src/lib/docs-client.js";
import { ToolExecutionError } from "../src/lib/errors.js";
import type { Logger } from "../src/lib/logger.js";
import type { OAuthSession } from "../src/lib/oauth.js";

function makeClient(responses: unknown[]): GoogleDocsClient {
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

  return new GoogleDocsClient({
    auth,
    logger,
    fetchImpl
  });
}

describe("resolver", () => {
  it("extracts a document id from a docs URL", () => {
    expect(parseDocumentIdFromUrl("https://docs.google.com/document/d/abc123_xyz/edit")).toBe(
      "abc123_xyz"
    );
  });

  it("returns deterministic not_found details for missing name resolution", async () => {
    const client = makeClient([
      {
        files: []
      }
    ]);

    await expect(client.getDocument({ name: "Missing Doc" }, false)).rejects.toMatchObject({
      kind: "not_found",
      details: {
        referenceType: "name",
        referenceValue: "Missing Doc",
        candidates: []
      }
    } satisfies Partial<ToolExecutionError>);
  });

  it("returns deterministic ambiguous details for path resolution", async () => {
    const client = makeClient([
      {
        files: [
          { id: "folder-1", name: "Projects", mimeType: "application/vnd.google-apps.folder" },
          { id: "folder-2", name: "Projects", mimeType: "application/vnd.google-apps.folder" }
        ]
      }
    ]);

    await expect(client.getDocument({ path: "Projects/Roadmap" }, false)).rejects.toMatchObject({
      kind: "tool_error",
      details: {
        referenceType: "path",
        referenceValue: "Projects/Roadmap",
        candidates: [
          { fileId: "folder-1", name: "Projects" },
          { fileId: "folder-2", name: "Projects" }
        ]
      }
    } satisfies Partial<ToolExecutionError>);
  });
});
