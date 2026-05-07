import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { requireActiveOrgAdmin } from "@/lib/auth/require-active-admin";

/**
 * Decision returned by `authorizeEventSync`. Drives both the route response
 * and the test assertions, so security-critical control flow stays exhaustive
 * and behaviorally testable.
 */
export type EventSyncAuthzDecision =
  | { ok: true; eventId: string; organizationId: string; createdByUserId: string | null }
  | { ok: false; status: 404; reason: "event_not_found" }
  | { ok: false; status: 403; reason: "not_admin_or_creator" };

interface AuthzInput {
  client: SupabaseClient<Database>;
  userId: string;
  eventId: string;
  organizationId: string;
}

/**
 * Authorize a calendar event-sync request.
 *
 * 1. Looks up the event scoped to BOTH `id` AND `organization_id` so a member
 *    of org A cannot fan out an event from org B. Missing or mis-scoped event
 *    => 404 (no enumeration).
 * 2. Allows the caller iff they are an active admin of the org OR the event
 *    creator.
 *
 * Returns a structured decision instead of throwing so callers can map it to
 * the appropriate HTTP response and tests can assert on the reason code.
 */
export async function authorizeEventSync(
  input: AuthzInput,
): Promise<EventSyncAuthzDecision> {
  const { client, userId, eventId, organizationId } = input;

  const { data: event } = await client
    .from("events")
    .select("id, organization_id, created_by_user_id")
    .eq("id", eventId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!event) {
    return { ok: false, status: 404, reason: "event_not_found" };
  }

  const isActiveAdmin = await requireActiveOrgAdmin(client, userId, organizationId);
  const isCreator = event.created_by_user_id === userId;

  if (!isActiveAdmin && !isCreator) {
    return { ok: false, status: 403, reason: "not_admin_or_creator" };
  }

  return {
    ok: true,
    eventId: event.id,
    organizationId: event.organization_id,
    createdByUserId: event.created_by_user_id,
  };
}
