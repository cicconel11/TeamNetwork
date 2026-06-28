import type { SupabaseClient } from "@supabase/supabase-js";
import {
  suggestConnections,
  SuggestConnectionsLookupError,
} from "@/lib/people-graph/suggestions";
import type { DisplayReadySuggestedConnection } from "@/lib/people-graph/scoring";

// Page surfaces show more than the chat tool's 3. This single knob is threaded
// into BOTH the engine's scored `limit` and its `display_limit`: the engine caps
// display at the scored pool size, so the scored limit must be >= the display cap
// for it to be reachable. clampSuggestionsLimit further bounds it to
// MAX_SUGGESTIONS_LIMIT (25), well above this value.
export const CONNECTIONS_PAGE_DISPLAY_LIMIT = 12;

export type ViewerSuggestionsState = "ok" | "no_source";

export interface ViewerSuggestionsResult {
  state: ViewerSuggestionsState;
  suggestions: DisplayReadySuggestedConnection[];
}

interface SourceRowLookup {
  id: string;
  user_id: string | null;
}

/**
 * Resolve the viewer's own projected person — the suggestion SOURCE — from their
 * auth `user_id`, scoped to the org and the soft-delete/active invariants the
 * engine itself enforces. We prefer a member row (active members are the primary
 * audience); we fall back to an alumni row when the viewer has no member projection.
 *
 * Returning the person_type + person_id (NOT the auth user_id) is what keeps R5
 * intact: suggestions are computed *from the viewer's own graph node*, so a viewer
 * can never be handed people they aren't already a peer of. A viewer with no
 * projected row anywhere yields `null` → an empty, non-error result upstream.
 */
async function resolveViewerSource(
  serviceSupabase: SupabaseClient,
  orgId: string,
  viewerUserId: string
): Promise<{ person_type: "member" | "alumni"; person_id: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = serviceSupabase as any;

  const { data: memberRow, error: memberError } = await client
    .from("members")
    .select("id, user_id")
    .eq("organization_id", orgId)
    .eq("user_id", viewerUserId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (memberError) {
    throw new Error(`Failed to resolve viewer member row: ${memberError.message}`);
  }

  const member = memberRow as SourceRowLookup | null;
  if (member?.id) {
    return { person_type: "member", person_id: member.id };
  }

  const { data: alumniRow, error: alumniError } = await client
    .from("alumni")
    .select("id, user_id")
    .eq("organization_id", orgId)
    .eq("user_id", viewerUserId)
    .is("deleted_at", null)
    .maybeSingle();

  if (alumniError) {
    throw new Error(`Failed to resolve viewer alumni row: ${alumniError.message}`);
  }

  const alumni = alumniRow as SourceRowLookup | null;
  if (alumni?.id) {
    return { person_type: "alumni", person_id: alumni.id };
  }

  return null;
}

/**
 * Source-from-viewer connection suggestions, shared by the HTTP route and the
 * connections page so the RLS invariant (suggest only from the viewer's own node)
 * lives in exactly one place.
 *
 * A viewer with no projected member/alumni row returns `{ state: "no_source" }`
 * with an empty list rather than throwing — the surfaces render a "complete your
 * profile" empty state, not a 500.
 */
export async function getViewerConnectionSuggestions(input: {
  serviceSupabase: SupabaseClient;
  orgId: string;
  viewerUserId: string;
  displayLimit?: number;
}): Promise<ViewerSuggestionsResult> {
  const { serviceSupabase, orgId, viewerUserId } = input;

  const source = await resolveViewerSource(serviceSupabase, orgId, viewerUserId);
  if (!source) {
    return { state: "no_source", suggestions: [] };
  }

  const displayLimit = input.displayLimit ?? CONNECTIONS_PAGE_DISPLAY_LIMIT;

  try {
    const result = await suggestConnections({
      orgId,
      serviceSupabase,
      args: {
        person_type: source.person_type,
        person_id: source.person_id,
        // The engine collapses display_limit down to the scored `limit`
        // (Math.min), so we must size the scored pool to at least the display
        // cap. clampSuggestionsLimit caps this at MAX_SUGGESTIONS_LIMIT (25);
        // our display caps stay well under it, so no constant import is needed.
        limit: displayLimit,
        display_limit: displayLimit,
      },
    });
    return { state: "ok", suggestions: result.suggestions };
  } catch (error) {
    // The source row existed a moment ago; a lookup miss here means it was
    // concurrently removed. Treat as "no source" (empty) rather than a 500.
    if (error instanceof SuggestConnectionsLookupError) {
      return { state: "no_source", suggestions: [] };
    }
    throw error;
  }
}
