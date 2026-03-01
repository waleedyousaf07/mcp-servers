import { describe, expect, it } from "vitest";
import {
  createDraftInputSchema,
  getThreadInputSchema,
  searchInputSchema,
  sendMessageInputSchema
} from "../src/lib/tools.js";

describe("tool schemas", () => {
  it("applies defaults for search", () => {
    const parsed = searchInputSchema.parse({
      query: "from:alerts"
    });

    expect(parsed.maxResults).toBe(10);
    expect(parsed.includeSnippet).toBe(true);
  });

  it("rejects thread maxMessages above the hard max", () => {
    expect(() =>
      getThreadInputSchema.parse({
        threadId: "abc",
        maxMessages: 101
      })
    ).toThrow(/100/);
  });

  it("requires at least one body field when creating drafts", () => {
    expect(() =>
      createDraftInputSchema.parse({
        to: "user@example.com",
        subject: "Hello",
        body: {}
      })
    ).toThrow(/body\.text or body\.html/);
  });

  it("accepts either a draft id or a full message when sending", () => {
    expect(
      sendMessageInputSchema.parse({
        draftId: "draft-123"
      }).draftId
    ).toBe("draft-123");

    expect(
      sendMessageInputSchema.parse({
        to: "user@example.com",
        subject: "Ship it",
        body: {
          text: "Hi"
        }
      }).subject
    ).toBe("Ship it");
  });

  it("rejects ambiguous send payloads", () => {
    expect(() =>
      sendMessageInputSchema.parse({
        draftId: "draft-123",
        to: "user@example.com",
        subject: "Hello",
        body: {
          text: "Hi"
        }
      })
    ).toThrow(/either draftId or full message fields/);
  });
});
