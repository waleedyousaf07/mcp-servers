import { describe, expect, it } from "vitest";
import {
  batchUpdateInputSchema,
  copyTemplateToFolderInputSchema,
  getDocumentInputSchema,
  insertTextInputSchema,
  searchDocumentsInputSchema
} from "../src/lib/tools.js";

describe("tool schemas", () => {
  it("applies defaults for searchDocuments", () => {
    const parsed = searchDocumentsInputSchema.parse({});

    expect(parsed.maxResults).toBe(10);
    expect(parsed.includeTrashed).toBe(false);
  });

  it("rejects search maxResults above hard max", () => {
    expect(() =>
      searchDocumentsInputSchema.parse({
        maxResults: 51
      })
    ).toThrow(/50/);
  });

  it("requires exactly one reference field", () => {
    expect(() =>
      getDocumentInputSchema.parse({
        name: "Q1 Notes",
        path: "Clients/Q1 Notes"
      })
    ).toThrow(/exactly one of id, url, name, or path/i);

    expect(() =>
      getDocumentInputSchema.parse({
        includeTabsContent: true
      })
    ).toThrow(/exactly one of id, url, name, or path/i);
  });

  it("requires insertText payload", () => {
    expect(() =>
      insertTextInputSchema.parse({
        id: "doc-1",
        text: "",
        index: 1
      })
    ).toThrow();
  });

  it("requires at least one batch update request", () => {
    expect(() =>
      batchUpdateInputSchema.parse({
        id: "doc-1",
        requests: []
      })
    ).toThrow();
  });

  it("validates template copy references and folder target", () => {
    expect(() =>
      copyTemplateToFolderInputSchema.parse({
        id: "template-doc-id",
        title: "Copied",
        folderUrl: "https://drive.google.com/drive/folders/abc123"
      })
    ).not.toThrow();

    expect(() =>
      copyTemplateToFolderInputSchema.parse({
        id: "template-doc-id",
        title: "Copied"
      })
    ).toThrow(/folderId or folderUrl/i);
  });

  it("accepts templateDocUrl alias and replacement object map", () => {
    const parsed = copyTemplateToFolderInputSchema.parse({
      templateDocUrl: "https://docs.google.com/document/d/template-id/edit",
      folderUrl: "https://drive.google.com/drive/folders/folder-id",
      title: "Copied CV",
      replacements: {
        "{{CANDIDATE_NAME}}": "Jane Doe",
        "{{TARGET_ROLE}}": "Senior Frontend Engineer"
      }
    });

    expect(parsed.url).toBe("https://docs.google.com/document/d/template-id/edit");
    expect(parsed.replacements).toEqual([
      { searchText: "{{CANDIDATE_NAME}}", replaceText: "Jane Doe" },
      { searchText: "{{TARGET_ROLE}}", replaceText: "Senior Frontend Engineer" }
    ]);
  });
});
