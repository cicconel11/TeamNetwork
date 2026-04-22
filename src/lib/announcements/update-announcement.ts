import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodIssue } from "zod";
import type { Database } from "@/types/database";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import {
  assistantAnnouncementPatchSchema,
  assistantPreparedAnnouncementSchema,
  type AssistantAnnouncementPatch,
} from "@/lib/schemas/content";

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

type DatabaseClient = SupabaseClient<Database>;
type AnnouncementRow = Database["public"]["Tables"]["announcements"]["Row"];

export interface UpdateAnnouncementRequest {
  supabase: DatabaseClient;
  orgId: string;
  userId: string;
  targetId: string;
  patch: AssistantAnnouncementPatch;
  /**
   * Caller-captured `target.updated_at` from prepare time. When supplied, the
   * write uses it as an optimistic-concurrency token both in-code (fast fail)
   * and in the UPDATE WHERE clause (race-safe). Omit for last-writer-wins
   * semantics.
   */
  expectedUpdatedAt?: string | null;
}

export async function updateAnnouncement(
  request: UpdateAnnouncementRequest
): Promise<DomainResult<AnnouncementRow>> {
  const parsed = assistantAnnouncementPatchSchema.safeParse(request.patch);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: "invalid_patch",
      details: issuesToDetails(parsed.error.issues),
    };
  }
  const patch = parsed.data;

  if (!Object.values(patch).some((v) => v !== undefined)) {
    return { ok: false, status: 400, error: "empty_patch" };
  }

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

  // Merge current + patch and re-validate against the full-row schema. This
  // catches cross-field invariants a partial patch could violate (e.g.,
  // changing audience to "individuals" without supplying audience_user_ids).
  const mergedTitle = patch.title ?? current.title;
  const mergedBody = patch.body ?? current.body;
  const mergedIsPinned = patch.is_pinned ?? Boolean(current.is_pinned);
  const mergedAudience = patch.audience ?? current.audience;
  const mergedAudienceUserIds =
    patch.audience_user_ids ?? current.audience_user_ids ?? undefined;

  const invariantCheck = assistantPreparedAnnouncementSchema.safeParse({
    title: mergedTitle,
    body: mergedBody ?? undefined,
    is_pinned: mergedIsPinned,
    audience: mergedAudience,
    send_notification: false, // not stored; satisfy the prepared-schema shape
    audience_user_ids: mergedAudienceUserIds ?? undefined,
  });

  if (!invariantCheck.success) {
    return {
      ok: false,
      status: 422,
      error: "invariant_violation",
      details: issuesToDetails(invariantCheck.error.issues),
    };
  }

  // Write the merged row rather than the raw patch — with the invariant
  // check above, this is safer than field-level last-writer-wins and the
  // optimistic-concurrency filter below prevents overwriting concurrent
  // changes.
  const updatePayload = {
    title: mergedTitle,
    body: mergedBody,
    is_pinned: mergedIsPinned,
    audience: mergedAudience,
    audience_user_ids:
      mergedAudience === "individuals"
        ? mergedAudienceUserIds ?? null
        : null,
  };

  let updateQuery = request.supabase
    .from("announcements")
    .update(updatePayload)
    .eq("id", request.targetId)
    .eq("organization_id", request.orgId)
    .is("deleted_at", null);

  if (request.expectedUpdatedAt != null) {
    updateQuery = updateQuery.eq("updated_at", request.expectedUpdatedAt);
  }

  const { data: updated, error: updateError } = await updateQuery
    .select("*")
    .maybeSingle();

  if (updateError) {
    return { ok: false, status: 500, error: "update_failed" };
  }
  if (!updated) {
    return { ok: false, status: 409, error: "stale_version" };
  }

  return { ok: true, value: updated };
}

function issuesToDetails(issues: ZodIssue[]): Record<string, unknown> {
  return Object.fromEntries(
    issues.map((issue) => [issue.path.join(".") || "body", issue.message])
  );
}
