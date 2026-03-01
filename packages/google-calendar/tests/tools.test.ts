import { describe, expect, it } from "vitest";
import {
  createEventInputSchema,
  listCalendarsInputSchema,
  listEventsInputSchema,
  updateEventInputSchema
} from "../src/lib/tools.js";

describe("tool schemas", () => {
  it("applies defaults for listCalendars", () => {
    const parsed = listCalendarsInputSchema.parse({});

    expect(parsed.maxResults).toBe(100);
    expect(parsed.showDeleted).toBe(false);
    expect(parsed.showHidden).toBe(false);
  });

  it("applies defaults for listEvents", () => {
    const parsed = listEventsInputSchema.parse({});

    expect(parsed.calendarId).toBe("primary");
    expect(parsed.maxResults).toBe(10);
    expect(parsed.singleEvents).toBe(true);
    expect(parsed.includeDeleted).toBe(false);
  });

  it("rejects calendar maxResults above the hard max", () => {
    expect(() =>
      listCalendarsInputSchema.parse({
        maxResults: 251
      })
    ).toThrow(/250/);
  });

  it("requires exactly one of date or dateTime for event times", () => {
    expect(() =>
      createEventInputSchema.parse({
        summary: "Planning",
        start: {},
        end: {
          date: "2026-03-01"
        }
      })
    ).toThrow(/exactly one/i);
  });

  it("rejects mixed all-day and timed ranges", () => {
    expect(() =>
      createEventInputSchema.parse({
        summary: "Planning",
        start: {
          date: "2026-03-01"
        },
        end: {
          dateTime: "2026-03-01T10:00:00Z"
        }
      })
    ).toThrow(/both use date or both use dateTime/i);
  });

  it("rejects updates with no changed fields", () => {
    expect(() =>
      updateEventInputSchema.parse({
        eventId: "abc123"
      })
    ).toThrow(/at least one event field/i);
  });
});
