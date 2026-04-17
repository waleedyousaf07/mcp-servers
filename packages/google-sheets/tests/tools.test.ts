import { describe, expect, it } from "vitest";
import {
  appendValuesInputSchema,
  getSpreadsheetInputSchema,
  searchSpreadsheetsInputSchema,
  updateValuesInputSchema
} from "../src/lib/tools.js";

describe("tool schemas", () => {
  it("applies defaults for searchSpreadsheets", () => {
    const parsed = searchSpreadsheetsInputSchema.parse({});

    expect(parsed.maxResults).toBe(10);
    expect(parsed.includeTrashed).toBe(false);
  });

  it("rejects search maxResults above hard max", () => {
    expect(() =>
      searchSpreadsheetsInputSchema.parse({
        maxResults: 51
      })
    ).toThrow(/50/);
  });

  it("requires exactly one reference field", () => {
    expect(() =>
      getSpreadsheetInputSchema.parse({
        id: "spreadsheet-1",
        name: "Budget"
      })
    ).toThrow(/exactly one of id, url, name, or path/i);
  });

  it("requires update values payload", () => {
    expect(() =>
      updateValuesInputSchema.parse({
        id: "spreadsheet-1",
        range: "Sheet1!A1:B2",
        values: []
      })
    ).toThrow();
  });

  it("accepts append values with defaults", () => {
    const parsed = appendValuesInputSchema.parse({
      id: "spreadsheet-1",
      range: "Sheet1!A1",
      values: [["hello"]]
    });

    expect(parsed.valueInputOption).toBe("USER_ENTERED");
    expect(parsed.insertDataOption).toBe("INSERT_ROWS");
  });
});
