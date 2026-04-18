import { z } from "zod";
import {
  DOCUMENT_SEARCH_DEFAULT_MAX_RESULTS,
  DOCUMENT_SEARCH_HARD_MAX_RESULTS
} from "./constants.js";

const referenceShape = {
  id: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  path: z.string().min(1).optional()
};

const folderReferenceShape = {
  folderId: z.string().min(1).optional(),
  folderUrl: z.string().min(1).optional()
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

const referenceSchema = z.object(referenceShape).superRefine(validateExactlyOneReference);

const writeControlSchema = z
  .object({
    requiredRevisionId: z.string().min(1).optional(),
    targetRevisionId: z.string().min(1).optional()
  })
  .superRefine((value, ctx) => {
    const selected = [value.requiredRevisionId, value.targetRevisionId].filter(Boolean);
    if (selected.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "writeControl must provide exactly one of requiredRevisionId or targetRevisionId."
      });
    }
  });

export const searchDocumentsInputShape = {
  query: z.string().min(1).optional(),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(DOCUMENT_SEARCH_HARD_MAX_RESULTS)
    .default(DOCUMENT_SEARCH_DEFAULT_MAX_RESULTS),
  pageToken: z.string().min(1).optional(),
  includeTrashed: z.boolean().default(false)
};

export const searchDocumentsInputSchema = z.object(searchDocumentsInputShape);

export const getDocumentInputShape = {
  ...referenceShape,
  includeTabsContent: z.boolean().default(false)
};

export const getDocumentInputSchema = z
  .object(getDocumentInputShape)
  .superRefine(validateExactlyOneReference);

export const createDocumentInputShape = {
  title: z.string().min(1),
  initialText: z.string().optional()
};

export const createDocumentInputSchema = z.object(createDocumentInputShape);

export const insertTextInputShape = {
  ...referenceShape,
  text: z.string().min(1),
  index: z.number().int().min(1).default(1)
};

export const insertTextInputSchema = z
  .object(insertTextInputShape)
  .superRefine(validateExactlyOneReference);

export const replaceAllTextInputShape = {
  ...referenceShape,
  searchText: z.string().min(1),
  replaceText: z.string(),
  matchCase: z.boolean().default(false)
};

export const replaceAllTextInputSchema = z
  .object(replaceAllTextInputShape)
  .superRefine(validateExactlyOneReference);

export const batchUpdateInputShape = {
  ...referenceShape,
  requests: z.array(z.record(z.string(), z.unknown())).min(1),
  writeControl: writeControlSchema.optional()
};

export const batchUpdateInputSchema = z
  .object(batchUpdateInputShape)
  .superRefine(validateExactlyOneReference);

export const copyTemplateToFolderInputShape = {
  ...referenceShape,
  ...folderReferenceShape,
  title: z.string().min(1),
  replacements: z
    .array(
      z.object({
        searchText: z.string().min(1),
        replaceText: z.string()
      })
    )
    .default([]),
  strictPlaceholderCheck: z.boolean().default(true),
  matchCase: z.boolean().default(false)
};

export const copyTemplateToFolderInputSchema = z
  .object(copyTemplateToFolderInputShape)
  .superRefine((value, ctx) => {
    validateExactlyOneReference(value, ctx);
    const folderPresent = [value.folderId, value.folderUrl].filter((item) => Boolean(item));
    if (folderPresent.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of folderId or folderUrl."
      });
    }
  });

export type DocumentReferenceInput = z.infer<typeof referenceSchema>;
