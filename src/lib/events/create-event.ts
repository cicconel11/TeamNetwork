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
  const startDateTime = new Date(`${input.start_date}T${input.start_time}`).toISOString();
  const endDateTime =
    input.end_date && input.end_time
      ? new Date(`${input.end_date}T${input.end_time}`).toISOString()
      : null;

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
      is_philanthropy: input.is_philanthropy,
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
