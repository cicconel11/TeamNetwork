import { assistantPreparedEventSchema, type AssistantPreparedEvent } from "@/lib/schemas/events-ai";
import { updateFutureEvents, type DeleteEventScope } from "./recurring-operations";
import { requireEventAdmin } from "./permissions";

export type UpdateEventScope = Exclude<DeleteEventScope, "all_in_series">;

export type UpdateEventResult =
  | { ok: true; event: Record<string, unknown>; affectedEventIds: string[]; syncWarnings: string[] }
  | { ok: false; status: number; error: string; details?: string[] };

function toIso(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

export async function updateEvent(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  orgId: string;
  actorUserId: string;
  eventId: string;
  data: AssistantPreparedEvent;
  scope: UpdateEventScope;
}): Promise<UpdateEventResult> {
  const permission = await requireEventAdmin({
    supabase: input.supabase,
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    action: "edit",
  });
  if (!permission.ok) return permission;

  const parsed = assistantPreparedEventSchema.safeParse(input.data);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: "Validation failed",
      details: parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`),
    };
  }

  const update = {
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    start_date: toIso(parsed.data.start_date, parsed.data.start_time),
    end_date:
      parsed.data.end_date && parsed.data.end_time
        ? toIso(parsed.data.end_date, parsed.data.end_time)
        : null,
    location: parsed.data.location ?? null,
    event_type: parsed.data.event_type,
    is_philanthropy: parsed.data.is_philanthropy,
    updated_at: new Date().toISOString(),
  };

  if (input.scope === "this_and_future") {
    const { updatedIds, error } = await updateFutureEvents(input.supabase, input.eventId, input.orgId, {
      title: update.title,
      description: update.description,
      location: update.location,
      event_type: update.event_type,
      is_philanthropy: update.is_philanthropy,
    });
    if (error) return { ok: false, status: 409, error };
    const { data: event } = await input.supabase
      .from("events")
      .select("*")
      .eq("id", input.eventId)
      .eq("organization_id", input.orgId)
      .maybeSingle();
    return { ok: true, event: event ?? { id: input.eventId, title: update.title }, affectedEventIds: updatedIds, syncWarnings: [] };
  }

  const { data: event, error } = await input.supabase
    .from("events")
    .update(update)
    .eq("id", input.eventId)
    .eq("organization_id", input.orgId)
    .is("deleted_at", null)
    .select("*")
    .single();

  if (error) return { ok: false, status: 500, error: "Failed to update event" };
  if (!event) return { ok: false, status: 404, error: "Event not found" };
  return { ok: true, event, affectedEventIds: [input.eventId], syncWarnings: [] };
}
