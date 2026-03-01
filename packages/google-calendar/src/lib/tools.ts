import { z } from "zod";
import {
  CALENDAR_LIST_DEFAULT_MAX_RESULTS,
  CALENDAR_LIST_HARD_MAX_RESULTS,
  EVENT_LIST_DEFAULT_MAX_RESULTS,
  EVENT_LIST_HARD_MAX_RESULTS
} from "./constants.js";

const attendeeValueSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
const sendUpdatesSchema = z.enum(["all", "externalOnly", "none"]).default("none");

const eventTimeSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTime: z.string().min(1).optional(),
    timeZone: z.string().min(1).optional()
  })
  .superRefine((value, ctx) => {
    const hasDate = Boolean(value.date);
    const hasDateTime = Boolean(value.dateTime);

    if (hasDate === hasDateTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of date or dateTime."
      });
    }
  });

export const listCalendarsInputShape = {
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(CALENDAR_LIST_HARD_MAX_RESULTS)
    .default(CALENDAR_LIST_DEFAULT_MAX_RESULTS),
  pageToken: z.string().min(1).optional(),
  showDeleted: z.boolean().default(false),
  showHidden: z.boolean().default(false)
};

export const listCalendarsInputSchema = z.object(listCalendarsInputShape);

export const listEventsInputShape = {
  calendarId: z.string().min(1).default("primary"),
  query: z.string().min(1).optional(),
  timeMin: z.string().min(1).optional(),
  timeMax: z.string().min(1).optional(),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(EVENT_LIST_HARD_MAX_RESULTS)
    .default(EVENT_LIST_DEFAULT_MAX_RESULTS),
  pageToken: z.string().min(1).optional(),
  includeDeleted: z.boolean().default(false),
  singleEvents: z.boolean().default(true)
};

export const listEventsInputSchema = z.object(listEventsInputShape);

export const getEventInputShape = {
  calendarId: z.string().min(1).default("primary"),
  eventId: z.string().min(1)
};

export const getEventInputSchema = z.object(getEventInputShape);

export const createEventInputShape = {
  calendarId: z.string().min(1).default("primary"),
  summary: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  start: eventTimeSchema,
  end: eventTimeSchema,
  attendees: attendeeValueSchema.optional(),
  sendUpdates: sendUpdatesSchema
};

export const createEventInputSchema = z.object(createEventInputShape).superRefine((value, ctx) => {
  const startMode = value.start.date ? "date" : "dateTime";
  const endMode = value.end.date ? "date" : "dateTime";

  if (startMode !== endMode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "start and end must both use date or both use dateTime."
    });
  }
});

export const updateEventInputShape = {
  calendarId: z.string().min(1).default("primary"),
  eventId: z.string().min(1),
  summary: z.string().min(1).optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: eventTimeSchema.optional(),
  end: eventTimeSchema.optional(),
  attendees: attendeeValueSchema.optional(),
  sendUpdates: sendUpdatesSchema
};

export const updateEventInputSchema = z.object(updateEventInputShape).superRefine((value, ctx) => {
  const hasChanges = Boolean(
    value.summary !== undefined ||
      value.description !== undefined ||
      value.location !== undefined ||
      value.start !== undefined ||
      value.end !== undefined ||
      value.attendees !== undefined
  );

  if (!hasChanges) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide at least one event field to update."
    });
  }

  if (value.start && value.end) {
    const startMode = value.start.date ? "date" : "dateTime";
    const endMode = value.end.date ? "date" : "dateTime";

    if (startMode !== endMode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "start and end must both use date or both use dateTime."
      });
    }
  }
});

export const deleteEventInputShape = {
  calendarId: z.string().min(1).default("primary"),
  eventId: z.string().min(1),
  sendUpdates: sendUpdatesSchema
};

export const deleteEventInputSchema = z.object(deleteEventInputShape);
