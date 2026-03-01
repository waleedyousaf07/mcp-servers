import { CALENDAR_API_ROOT } from "./constants.js";
import { ToolExecutionError, mapGoogleApiError } from "./errors.js";
import type { Logger } from "./logger.js";
import type { OAuthSession } from "./oauth.js";
import { encodeQuery, sleep, toArray } from "./utils.js";

type SendUpdates = "all" | "externalOnly" | "none";

interface CalendarListEntryResource {
  id?: string;
  summary?: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
  backgroundColor?: string;
  foregroundColor?: string;
}

interface CalendarListResponse {
  items?: CalendarListEntryResource[];
  nextPageToken?: string;
}

interface EventTimeResource {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface EventOrganizerResource {
  email?: string;
  displayName?: string;
  self?: boolean;
}

interface EventAttendeeResource {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  optional?: boolean;
  self?: boolean;
  organizer?: boolean;
}

interface EventResource {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
  start?: EventTimeResource;
  end?: EventTimeResource;
  organizer?: EventOrganizerResource;
  attendees?: EventAttendeeResource[];
}

interface EventListResponse {
  items?: EventResource[];
  nextPageToken?: string;
}

export interface NormalizedEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface CalendarEvent {
  eventId: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
  start?: NormalizedEventTime;
  end?: NormalizedEventTime;
  organizer?: {
    email?: string;
    displayName?: string;
    self?: boolean;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
    optional?: boolean;
    self?: boolean;
    organizer?: boolean;
  }>;
}

export interface EventMutationInput {
  calendarId?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: NormalizedEventTime;
  end?: NormalizedEventTime;
  attendees?: string | string[];
  sendUpdates?: SendUpdates;
}

export class GoogleCalendarClient {
  private readonly auth: OAuthSession;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { auth: OAuthSession; logger: Logger; fetchImpl?: typeof fetch }) {
    this.auth = options.auth;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listCalendars(input: {
    maxResults: number;
    pageToken?: string;
    showDeleted: boolean;
    showHidden: boolean;
  }): Promise<{
    calendars: Array<{
      calendarId: string;
      summary: string;
      primary?: boolean;
      accessRole?: string;
      timeZone?: string;
      backgroundColor?: string;
      foregroundColor?: string;
    }>;
    nextPageToken?: string;
  }> {
    const response = await this.requestJson<CalendarListResponse>(
      "calendar.listCalendars",
      `/users/me/calendarList${encodeQuery({
        maxResults: input.maxResults,
        pageToken: input.pageToken,
        showDeleted: input.showDeleted,
        showHidden: input.showHidden
      })}`
    );

    return {
      calendars: (response.items ?? [])
        .filter((entry): entry is CalendarListEntryResource & { id: string; summary: string } =>
          Boolean(entry.id && entry.summary)
        )
        .map((entry) => ({
          calendarId: entry.id,
          summary: entry.summary,
          primary: entry.primary,
          accessRole: entry.accessRole,
          timeZone: entry.timeZone,
          backgroundColor: entry.backgroundColor,
          foregroundColor: entry.foregroundColor
        })),
      nextPageToken: response.nextPageToken
    };
  }

  async listEvents(input: {
    calendarId: string;
    query?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults: number;
    pageToken?: string;
    includeDeleted: boolean;
    singleEvents: boolean;
  }): Promise<{
    calendarId: string;
    events: CalendarEvent[];
    nextPageToken?: string;
  }> {
    const response = await this.requestJson<EventListResponse>(
      "calendar.listEvents",
      `/calendars/${encodeURIComponent(input.calendarId)}/events${encodeQuery({
        q: input.query,
        timeMin: input.timeMin,
        timeMax: input.timeMax,
        maxResults: input.maxResults,
        pageToken: input.pageToken,
        showDeleted: input.includeDeleted,
        singleEvents: input.singleEvents,
        orderBy: input.singleEvents ? "startTime" : undefined
      })}`
    );

    return {
      calendarId: input.calendarId,
      events: (response.items ?? []).map((event) => normalizeEvent(event)),
      nextPageToken: response.nextPageToken
    };
  }

  async getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
    const event = await this.requestJson<EventResource>(
      "calendar.getEvent",
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    );

    return normalizeEvent(event);
  }

  async createEvent(
    input: EventMutationInput & {
      calendarId?: string;
      summary: string;
      start: NormalizedEventTime;
      end: NormalizedEventTime;
    }
  ): Promise<CalendarEvent> {
    const calendarId = input.calendarId ?? "primary";
    const event = await this.requestJson<EventResource>(
      "calendar.createEvent",
      `/calendars/${encodeURIComponent(calendarId)}/events${encodeQuery({
        sendUpdates: input.sendUpdates ?? "none"
      })}`,
      {
        method: "POST",
        body: JSON.stringify(buildEventBody(input))
      }
    );

    return normalizeEvent(event);
  }

  async updateEvent(
    input: EventMutationInput & {
      calendarId?: string;
      eventId: string;
    }
  ): Promise<CalendarEvent> {
    const calendarId = input.calendarId ?? "primary";
    const event = await this.requestJson<EventResource>(
      "calendar.updateEvent",
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}${encodeQuery(
        {
          sendUpdates: input.sendUpdates ?? "none"
        }
      )}`,
      {
        method: "PATCH",
        body: JSON.stringify(buildEventBody(input))
      }
    );

    return normalizeEvent(event);
  }

  async deleteEvent(
    calendarId: string,
    eventId: string,
    sendUpdates: SendUpdates
  ): Promise<{ deleted: true; calendarId: string; eventId: string }> {
    await this.requestJson<unknown>(
      "calendar.deleteEvent",
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${encodeQuery(
        {
          sendUpdates
        }
      )}`,
      {
        method: "DELETE"
      }
    );

    return {
      deleted: true,
      calendarId,
      eventId
    };
  }

  private async requestJson<T>(
    operation: string,
    path: string,
    init?: RequestInit,
    attempt = 0,
    hasRetriedAfterRefresh = false
  ): Promise<T> {
    const token = await this.auth.getAccessToken(false);
    const started = Date.now();

    try {
      const response = await this.fetchImpl(`${CALENDAR_API_ROOT}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(init?.headers ?? {})
        }
      });

      if (response.status === 401 && !hasRetriedAfterRefresh) {
        await this.auth.getAccessToken(true);
        return this.requestJson<T>(operation, path, init, attempt, true);
      }

      if (!response.ok) {
        const payload = await parseJsonSafely(response);
        if (shouldRetry(response.status) && attempt < 3) {
          await sleep(retryDelayMs(attempt));
          return this.requestJson<T>(operation, path, init, attempt + 1, hasRetriedAfterRefresh);
        }
        throw mapGoogleApiError(response.status, payload, operation);
      }

      const payload = (await parseJsonSafely(response)) as T;
      this.logger.info("calendar_request_complete", {
        operation,
        durationMs: Date.now() - started
      });
      return payload;
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        throw error;
      }

      if (attempt < 3) {
        await sleep(retryDelayMs(attempt));
        return this.requestJson<T>(operation, path, init, attempt + 1, hasRetriedAfterRefresh);
      }

      throw new ToolExecutionError(`Network failure during ${operation}.`, {
        kind: "network_error",
        cause: error
      });
    }
  }
}

function shouldRetry(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(attempt: number): number {
  const base = 250 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 150);
  return base + jitter;
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function normalizeEvent(event: EventResource): CalendarEvent {
  if (!event.id) {
    throw new ToolExecutionError("Google returned an event without an id.", {
      kind: "api_error"
    });
  }

  const attendees = (event.attendees ?? [])
    .filter((attendee): attendee is EventAttendeeResource & { email: string } => Boolean(attendee.email))
    .map((attendee) => ({
      email: attendee.email,
      displayName: attendee.displayName,
      responseStatus: attendee.responseStatus,
      optional: attendee.optional,
      self: attendee.self,
      organizer: attendee.organizer
    }));

  return {
    eventId: event.id,
    status: event.status,
    summary: event.summary,
    description: event.description,
    location: event.location,
    htmlLink: event.htmlLink,
    created: event.created,
    updated: event.updated,
    start: normalizeEventTime(event.start),
    end: normalizeEventTime(event.end),
    organizer: event.organizer
      ? {
          email: event.organizer.email,
          displayName: event.organizer.displayName,
          self: event.organizer.self
        }
      : undefined,
    attendees: attendees.length ? attendees : undefined
  };
}

function normalizeEventTime(value?: EventTimeResource): NormalizedEventTime | undefined {
  if (!value || (!value.date && !value.dateTime)) {
    return undefined;
  }

  return {
    date: value.date,
    dateTime: value.dateTime,
    timeZone: value.timeZone
  };
}

function buildEventBody(input: EventMutationInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (input.summary !== undefined) {
    body.summary = input.summary;
  }
  if (input.description !== undefined) {
    body.description = input.description;
  }
  if (input.location !== undefined) {
    body.location = input.location;
  }
  if (input.start !== undefined) {
    body.start = buildEventTime(input.start);
  }
  if (input.end !== undefined) {
    body.end = buildEventTime(input.end);
  }

  const attendees = toArray(input.attendees);
  if (attendees) {
    body.attendees = attendees.map((email) => ({ email }));
  }

  return body;
}

function buildEventTime(value: NormalizedEventTime): Record<string, string> {
  if (value.dateTime) {
    return {
      dateTime: value.dateTime,
      ...(value.timeZone ? { timeZone: value.timeZone } : {})
    };
  }

  if (value.date) {
    return {
      date: value.date,
      ...(value.timeZone ? { timeZone: value.timeZone } : {})
    };
  }

  throw new ToolExecutionError("Event time is missing date or dateTime.", {
    kind: "tool_error"
  });
}
