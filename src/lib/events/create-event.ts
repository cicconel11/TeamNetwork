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
      details?: string[];
    };

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

  if (error || !event) {
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
