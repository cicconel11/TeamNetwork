import { deleteEventsInSeries, type DeleteEventScope } from "./recurring-operations";
import { requireEventAdmin } from "./permissions";

export type DeleteEventResult =
  | { ok: true; eventId: string; affectedEventIds: string[]; syncWarnings: string[] }
  | { ok: false; status: number; error: string };

export async function deleteEvent(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  orgId: string;
  actorUserId: string;
  eventId: string;
  scope: DeleteEventScope;
}): Promise<DeleteEventResult> {
  const permission = await requireEventAdmin({
    supabase: input.supabase,
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    action: "delete",
  });
  if (!permission.ok) return permission;

  const { deletedIds, error } = await deleteEventsInSeries(
    input.supabase,
    input.eventId,
    input.orgId,
    input.scope,
  );
  if (error) return { ok: false, status: 409, error };
  if (deletedIds.length === 0) {
    return { ok: false, status: 409, error: "No events were deleted" };
  }
  return {
    ok: true,
    eventId: input.eventId,
    affectedEventIds: deletedIds,
    syncWarnings: [],
  };
}
