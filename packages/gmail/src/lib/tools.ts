import { z } from "zod";
import {
  SEARCH_DEFAULT_MAX_RESULTS,
  SEARCH_HARD_MAX_RESULTS,
  THREAD_DEFAULT_MAX_MESSAGES,
  THREAD_HARD_MAX_MESSAGES
} from "./constants.js";

const addressValueSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

const messageBodySchema = z
  .object({
    text: z.string().optional(),
    html: z.string().optional()
  })
  .superRefine((value, ctx) => {
    if (!value.text && !value.html) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "body.text or body.html is required."
      });
    }
  });

export const searchInputShape = {
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(SEARCH_HARD_MAX_RESULTS).default(SEARCH_DEFAULT_MAX_RESULTS),
  includeSnippet: z.boolean().default(true)
};

export const searchInputSchema = z.object(searchInputShape);

export const getThreadInputShape = {
  threadId: z.string().min(1),
  includeBodies: z.boolean().default(false),
  bodyFormat: z.enum(["text", "html", "both"]).default("text"),
  maxMessages: z
    .number()
    .int()
    .min(1)
    .max(THREAD_HARD_MAX_MESSAGES)
    .default(THREAD_DEFAULT_MAX_MESSAGES)
};

export const getThreadInputSchema = z.object(getThreadInputShape);

export const getMessageInputShape = {
  messageId: z.string().min(1),
  includeBody: z.boolean().default(false),
  bodyFormat: z.enum(["text", "html", "both"]).default("text")
};

export const getMessageInputSchema = z.object(getMessageInputShape);

export const listLabelsInputShape = {};

export const createDraftInputShape = {
  to: addressValueSchema,
  cc: addressValueSchema.optional(),
  bcc: addressValueSchema.optional(),
  subject: z.string().min(1),
  body: messageBodySchema,
  replyToMessageId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional()
};

export const createDraftInputSchema = z.object(createDraftInputShape);

export const sendMessageInputShape = {
  draftId: z.string().min(1).optional(),
  to: addressValueSchema.optional(),
  cc: addressValueSchema.optional(),
  bcc: addressValueSchema.optional(),
  subject: z.string().min(1).optional(),
  body: messageBodySchema.optional(),
  replyToMessageId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional()
};

export const sendMessageInputSchema = z
  .object(sendMessageInputShape)
  .superRefine((value, ctx) => {
    const hasDraft = Boolean(value.draftId);
    const hasFullMessage = Boolean(value.to && value.subject && value.body);

    if (hasDraft === hasFullMessage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either draftId or full message fields."
      });
    }
  });
