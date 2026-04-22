import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodIssue } from "zod";
import type { Database } from "@/types/database";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import {
  assistantEventPatchSchema,
  assistantPreparedEventSchema,
  type AssistantEventPatch,
} from "@/lib/schemas/events-ai";

// Local mirror of the shared DomainResult type — kept here so this PR is
// self-contained while the shared module (from the Phase 1b scaffolding)
// propagates into `src/lib/announcements/update-announcement.ts` and the
// rest of Tier 1. Refactor to the shared import in a follow-up.
export type DomainResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409 | 410 | 422 | 500;
      error: string;
      details?: Record<string, unknown>;
    };

type DatabaseClient = SupabaseClient<Database>;
type EventRow = Database["public"]["Tables"]["events"]["Row"];

export interface UpdateEventRequest {
  supabase: DatabaseClient;
  orgId: string;
  userId: string;
  targetId: string;
  patch: AssistantEventPatch;
  /**
   * Caller-captured `target.updated_at` from prepare time. When supplied, the
   * write uses it as an optimistic-concurrency token both in-code (fast fail)
   * and in the UPDATE WHERE clause (race-safe). Omit for last-writer-wins
   * semantics.
   */
  expectedUpdatedAt?: string | null;
}

export async function updateEvent(
  request: UpdateEventRequest
): Promise<DomainResult<EventRow>> {
  const parsed = assistantEventPatchSchema.safeParse(request.patch);
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
    .from("events")
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

  // Tier 4 guard: recurring events are out of scope for Phase 3. Any row
  // that is part of a recurrence series (has a group id, is the parent
  // with a rule, or is an individual instance) is rejected. The plan
  // explicitly defers recurrence edit semantics (`this_only` /
  // `this_and_future` / `all_in_series`) to Tier 4.
  if (
    current.recurrence_group_id !== null ||
    current.recurrence_rule !== null ||
    current.recurrence_index !== null
  ) {
    return {
      ok: false,
      status: 422,
      error: "recurring_event_unsupported",
      details: {
        message:
          "Editing recurring events is not supported yet. Ask the user to edit a single, non-recurring event.",
      },
    };
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

  // Decompose the current row's stored ISO `start_date` / `end_date` strings
  // back into the YYYY-MM-DD + HH:MM parts used by the patch schema so we
  // can merge patch over current and re-validate the combined shape against
  // `assistantPreparedEventSchema` (catches end > start invariants, etc.).
  const currentStart = decomposeIsoToDateTime(current.start_date);
  if (!currentStart) {
    return {
      ok: false,
      status: 500,
      error: "corrupt_start_date",
      details: { value: current.start_date },
    };
  }
  const currentEnd = current.end_date
    ? decomposeIsoToDateTime(current.end_date)
    : null;

  const mergedStartDate = patch.start_date ?? currentStart.date;
  const mergedStartTime = patch.start_time ?? currentStart.time;
  const mergedEndDate =
    patch.end_date !== undefined ? patch.end_date : currentEnd?.date ?? "";
  const mergedEndTime =
    patch.end_time !== undefined ? patch.end_time : currentEnd?.time ?? "";
  const mergedTitle = patch.title ?? current.title;
  const mergedDescription =
    patch.description !== undefined ? patch.description : current.description;
  const mergedLocation =
    patch.location !== undefined ? patch.location : current.location;
  const mergedEventType = patch.event_type ?? current.event_type;
  const mergedIsPhilanthropy =
    patch.is_philanthropy ?? Boolean(current.is_philanthropy);

  const invariantCheck = assistantPreparedEventSchema.safeParse({
    title: mergedTitle,
    description: mergedDescription ?? undefined,
    start_date: mergedStartDate,
    start_time: mergedStartTime,
    end_date: mergedEndDate,
    end_time: mergedEndTime,
    location: mergedLocation ?? undefined,
    event_type: mergedEventType,
    is_philanthropy: mergedIsPhilanthropy,
  });

  if (!invariantCheck.success) {
    return {
      ok: false,
      status: 422,
      error: "invariant_violation",
      details: issuesToDetails(invariantCheck.error.issues),
    };
  }

  // Recompose merged date+time pairs back into the ISO strings the DB stores.
  // Mirrors `createEvent`'s composition — treat as wall-clock time (no
  // timezone shift) so browser forms and agent edits stay consistent.
  const nextStartIso = `${mergedStartDate}T${mergedStartTime}:00.000Z`;
  const nextEndIso =
    mergedEndDate && mergedEndTime
      ? `${mergedEndDate}T${mergedEndTime}:00.000Z`
      : null;

  const updatePayload: Database["public"]["Tables"]["events"]["Update"] = {
    title: mergedTitle,
    description: mergedDescription ?? null,
    start_date: nextStartIso,
    end_date: nextEndIso,
    location: mergedLocation ?? null,
    event_type: mergedEventType,
    is_philanthropy: mergedIsPhilanthropy || mergedEventType === "philanthropy",
  };

  let updateQuery = request.supabase
    .from("events")
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

function decomposeIsoToDateTime(
  iso: string
): { date: string; time: string } | null {
  // Accepts "2026-04-22T09:00:00.000Z" (UTC wall-clock) — matches how
  // `createEvent` composes it. We parse the leading date + HH:MM chunks
  // directly rather than routing through `new Date(…)` to avoid local-
  // timezone drift on the HH:MM extraction.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) {
    return null;
  }
  return { date: match[1], time: `${match[2]}:${match[3]}` };
}

function issuesToDetails(issues: ZodIssue[]): Record<string, unknown> {
  return Object.fromEntries(
    issues.map((issue) => [issue.path.join(".") || "body", issue.message])
  );
}
