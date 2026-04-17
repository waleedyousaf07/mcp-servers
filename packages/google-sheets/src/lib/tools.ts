import { z } from "zod";
import {
  SPREADSHEET_SEARCH_DEFAULT_MAX_RESULTS,
  SPREADSHEET_SEARCH_HARD_MAX_RESULTS
} from "./constants.js";

const referenceShape = {
  id: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  path: z.string().min(1).optional()
};

function validateExactlyOneReference(
  value: Partial<Record<keyof typeof referenceShape, string | undefined>>,
  ctx: z.RefinementCtx
): void {
  const present = [value.id, value.url, value.name, value.path].filter((item) => Boolean(item));
  if (present.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide exactly one of id, url, name, or path."
    });
  }
}

const dimensionSchema = z.enum(["ROWS", "COLUMNS"]).default("ROWS");
const valueInputOptionSchema = z.enum(["RAW", "USER_ENTERED"]).default("USER_ENTERED");
const insertDataOptionSchema = z.enum(["OVERWRITE", "INSERT_ROWS"]).default("INSERT_ROWS");
const valueRenderOptionSchema = z
  .enum(["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"])
  .default("FORMATTED_VALUE");
const dateTimeRenderOptionSchema = z.enum(["SERIAL_NUMBER", "FORMATTED_STRING"]).default("SERIAL_NUMBER");

const valuesSchema = z.array(z.array(z.unknown()).min(1)).min(1);

export const searchSpreadsheetsInputShape = {
  query: z.string().min(1).optional(),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(SPREADSHEET_SEARCH_HARD_MAX_RESULTS)
    .default(SPREADSHEET_SEARCH_DEFAULT_MAX_RESULTS),
  pageToken: z.string().min(1).optional(),
  includeTrashed: z.boolean().default(false)
};

export const searchSpreadsheetsInputSchema = z.object(searchSpreadsheetsInputShape);

export const getSpreadsheetInputShape = {
  ...referenceShape,
  includeGridData: z.boolean().default(false),
  ranges: z.array(z.string().min(1)).optional()
};

export const getSpreadsheetInputSchema = z
  .object(getSpreadsheetInputShape)
  .superRefine(validateExactlyOneReference);

export const createSpreadsheetInputShape = {
  title: z.string().min(1),
  sheetTitle: z.string().min(1).optional()
};

export const createSpreadsheetInputSchema = z.object(createSpreadsheetInputShape);

export const getValuesInputShape = {
  ...referenceShape,
  range: z.string().min(1),
  majorDimension: dimensionSchema,
  valueRenderOption: valueRenderOptionSchema,
  dateTimeRenderOption: dateTimeRenderOptionSchema
};

export const getValuesInputSchema = z
  .object(getValuesInputShape)
  .superRefine(validateExactlyOneReference);

export const batchGetValuesInputShape = {
  ...referenceShape,
  ranges: z.array(z.string().min(1)).min(1),
  majorDimension: dimensionSchema,
  valueRenderOption: valueRenderOptionSchema,
  dateTimeRenderOption: dateTimeRenderOptionSchema
};

export const batchGetValuesInputSchema = z
  .object(batchGetValuesInputShape)
  .superRefine(validateExactlyOneReference);

export const updateValuesInputShape = {
  ...referenceShape,
  range: z.string().min(1),
  values: valuesSchema,
  majorDimension: dimensionSchema,
  valueInputOption: valueInputOptionSchema,
  includeValuesInResponse: z.boolean().default(false),
  responseValueRenderOption: valueRenderOptionSchema,
  responseDateTimeRenderOption: dateTimeRenderOptionSchema
};

export const updateValuesInputSchema = z
  .object(updateValuesInputShape)
  .superRefine(validateExactlyOneReference);

export const appendValuesInputShape = {
  ...referenceShape,
  range: z.string().min(1),
  values: valuesSchema,
  majorDimension: dimensionSchema,
  valueInputOption: valueInputOptionSchema,
  insertDataOption: insertDataOptionSchema,
  includeValuesInResponse: z.boolean().default(false),
  responseValueRenderOption: valueRenderOptionSchema,
  responseDateTimeRenderOption: dateTimeRenderOptionSchema
};

export const appendValuesInputSchema = z
  .object(appendValuesInputShape)
  .superRefine(validateExactlyOneReference);

export const clearValuesInputShape = {
  ...referenceShape,
  range: z.string().min(1)
};

export const clearValuesInputSchema = z
  .object(clearValuesInputShape)
  .superRefine(validateExactlyOneReference);

export const batchUpdateInputShape = {
  ...referenceShape,
  requests: z.array(z.record(z.string(), z.unknown())).min(1),
  includeSpreadsheetInResponse: z.boolean().default(false),
  responseRanges: z.array(z.string().min(1)).optional(),
  responseIncludeGridData: z.boolean().default(false)
};

export const batchUpdateInputSchema = z
  .object(batchUpdateInputShape)
  .superRefine(validateExactlyOneReference);

export type SpreadsheetReferenceInput = {
  id?: string;
  url?: string;
  name?: string;
  path?: string;
};
