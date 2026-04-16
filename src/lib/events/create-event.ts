/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  assistantPreparedEventSchema,
  type AssistantPreparedEvent,
} from "@/lib/schemas/events-ai";

export interface CreateEventInput {
  supabase: any;
  serviceSupabase: any;
  orgId: string;
  userId: string;
  input: AssistantPreparedEvent;
  orgSlug?: string | null;
}

export interface CreateEventInternalError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export type CreateEventErrorCode = "event_type_unavailable";

export type CreateEventResult =
  | {
      ok: true;
      status: 201;
      event: { id: string; title: string };
      eventUrl: string;
    }
  | {
      ok: false;
      status: 400 | 403 | 500;
      error: string;
      code?: CreateEventErrorCode;
      details?: string[];
      internalError?: CreateEventInternalError;
    };

function normalizeCreateEventInternalError(error: unknown): CreateEventInternalError | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as Record<string, unknown>;
  return {
    code: typeof candidate.code === "string" ? candidate.code : null,
    message: typeof candidate.message === "string" ? candidate.message : null,
    details: typeof candidate.details === "string" ? candidate.details : null,
    hint: typeof candidate.hint === "string" ? candidate.hint : null,
  };
}

function isUnsupportedEventTypeInsertError(
  error: CreateEventInternalError | undefined,
  eventType: AssistantPreparedEvent["event_type"],
): boolean {
  if (!error) {
    return false;
  }

  const combined = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return (
    (error.code === "22P02" || combined.includes("invalid input value for enum"))
    && combined.includes("event_type")
    && combined.includes(String(eventType).toLowerCase())
  );
}

export async function createEvent(req: CreateEventInput): Promise<CreateEventResult> {
  const validationResult = assistantPreparedEventSchema.safeParse(req.input);
  if (!validationResult.success) {
    const details = validationResult.error.issues.map(
      (issue) => `${issue.path.join(".") || "body"}: ${issue.message}`,
    );

    return {
      ok: false,
      status: 400,
      error: "Invalid event data",
      details,
    };
  }

  const input = validationResult.data;

  // Treat as wall-clock time (no timezone shift) — matches browser form behavior
  const startDateTime = `${input.start_date}T${input.start_time}:00.000Z`;

  // Handle partial end info: fill in missing half from start values
  const effectiveEndDate = input.end_date || input.start_date;
  const effectiveEndTime = input.end_time || input.start_time;
  const endDateTime =
    input.end_date || input.end_time
      ? `${effectiveEndDate}T${effectiveEndTime}:00.000Z`
      : null;

  // Validate dates are real calendar dates
  const startCheck = new Date(startDateTime);
  if (isNaN(startCheck.getTime())) {
    return { ok: false, status: 400, error: "Invalid start date or time" };
  }
  if (endDateTime) {
    const endCheck = new Date(endDateTime);
    if (isNaN(endCheck.getTime())) {
      return { ok: false, status: 400, error: "Invalid end date or time" };
    }
    if (endCheck <= startCheck) {
      return { ok: false, status: 400, error: "End date/time must be after start date/time" };
    }
  }

  const { data: event, error } = await req.supabase
    .from("events")
    .insert({
      organization_id: req.orgId,
      title: input.title,
      description: input.description || null,
      start_date: startDateTime,
      end_date: endDateTime,
      location: input.location || null,
      event_type: input.event_type,
      is_philanthropy: input.is_philanthropy || input.event_type === "philanthropy",
      created_by_user_id: req.userId,
      audience: "both",
    })
    .select("id, title")
    .single();

  if (error) {
    const internalError = normalizeCreateEventInternalError(error);

    if (isUnsupportedEventTypeInsertError(internalError, input.event_type)) {
      return {
        ok: false,
        status: 500,
        code: "event_type_unavailable",
        error:
          "This environment does not support the selected event type yet. Apply the latest database migrations and try again.",
        internalError,
      };
    }

    return {
      ok: false,
      status: 500,
      error: "Failed to create event",
      internalError,
    };
  }

  if (!event) {
    return { ok: false, status: 500, error: "Failed to create event" };
  }

  const eventUrl = req.orgSlug ? `/${req.orgSlug}/events/${event.id}` : "";

  return {
    ok: true,
    status: 201,
    event: {
      id: event.id,
      title: event.title,
    },
    eventUrl,
  };
}
