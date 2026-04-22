import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getOrgMembership } from "@/lib/auth/api-helpers";

type DatabaseClient = SupabaseClient<Database>;
type AnnouncementRow = Database["public"]["Tables"]["announcements"]["Row"];

// Local mirror of the shared DomainResult type (defined in a companion PR).
// Kept here so this PR is self-contained; refactor to the shared module in a
// follow-up once both land.
export type DomainResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409 | 410 | 422 | 500;
      error: string;
      details?: Record<string, unknown>;
    };

export interface SoftDeleteAnnouncementRequest {
  supabase: DatabaseClient;
  orgId: string;
  userId: string;
  targetId: string;
  /**
   * Caller-captured `target.updated_at` from prepare time. When supplied, the
   * write uses it as an optimistic-concurrency token both in-code (fast fail)
   * and in the UPDATE WHERE clause (race-safe). Omit for last-writer-wins
   * semantics.
   */
  expectedUpdatedAt?: string | null;
}

export async function softDeleteAnnouncement(
  request: SoftDeleteAnnouncementRequest
): Promise<DomainResult<AnnouncementRow>> {
  const membership = await getOrgMembership(
    request.supabase,
    request.userId,
    request.orgId
  );
  if (!membership || membership.role !== "admin") {
    return { ok: false, status: 403, error: "forbidden" };
  }

  const { data: current, error: fetchError } = await request.supabase
    .from("announcements")
    .select("*")
    .eq("id", request.targetId)
    .eq("organization_id", request.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return { ok: false, status: 500, error: "fetch_failed" };
  }
  if (!current) {
    return { ok: false, status: 404, error: "not_found" };
  }

  if (
    request.expectedUpdatedAt != null &&
    current.updated_at !== request.expectedUpdatedAt
  ) {
    return {
      ok: false,
      status: 409,
      error: "stale_version",
      details: {
        expectedUpdatedAt: request.expectedUpdatedAt,
        currentUpdatedAt: current.updated_at,
      },
    };
  }

  // Stamp both deleted_at and updated_at with the same instant. updated_at
  // serves as the next optimistic-concurrency token if anything else races
  // with this row (e.g., a lingering edit prepared just before the delete).
  const now = new Date().toISOString();

  let updateQuery = request.supabase
    .from("announcements")
    .update({ deleted_at: now, updated_at: now })
    .eq("id", request.targetId)
    .eq("organization_id", request.orgId)
    .is("deleted_at", null);

  if (request.expectedUpdatedAt != null) {
    updateQuery = updateQuery.eq("updated_at", request.expectedUpdatedAt);
  }

  const { data: deleted, error: updateError } = await updateQuery
    .select("*")
    .maybeSingle();

  if (updateError) {
    return { ok: false, status: 500, error: "delete_failed" };
  }
  if (!deleted) {
    // Zero rows → either the row was deleted concurrently (deleted_at IS NULL
    // filter miss) or updated_at advanced between our read and write.
    return { ok: false, status: 409, error: "stale_version" };
  }

  return { ok: true, value: deleted };
}
