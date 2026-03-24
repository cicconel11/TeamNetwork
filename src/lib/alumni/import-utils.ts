// Shared utilities for bulk alumni import components

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { lookupAuthUsersByEmail } from "@/lib/supabase/auth-schema";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImportResultBase {
  updated: number;
  created: number;
  skipped: number;
  quotaBlocked: number;
  errors: string[];
}

export interface CreatedAlumniRecord {
  id: string;
  email?: string;
  firstName: string;
  lastName: string;
}

export interface ImportSummary {
  willCreate: number;
  willUpdate: number;
  willSkip: number;
  quotaBlocked: number;
  invalid: number;
}

/** Status values returned by bulk import RPC functions (out_status column). */
export const IMPORT_STATUS = {
  CREATED: "created",
  UPDATED_EXISTING: "updated_existing",
  SKIPPED_EXISTING: "skipped_existing",
  QUOTA_EXCEEDED: "quota_exceeded",
} as const;

export type ImportStatus = (typeof IMPORT_STATUS)[keyof typeof IMPORT_STATUS];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve unmatched emails by looking up auth.users → alumni.user_id.
 * Returns a new Map with discovered matches (does not mutate inputs).
 */
export async function resolveUnmatchedEmailsByUserId<T>(opts: {
  unmatchedEmails: string[];
  organizationId: string;
  serviceSupabase: SupabaseClient<Database>;
  existingKeys: ReadonlySet<string>;
  selectColumns: string;
  buildValue: (alum: Record<string, unknown>) => T;
}): Promise<Map<string, T>> {
  const { unmatchedEmails, organizationId, serviceSupabase, existingKeys, selectColumns, buildValue } = opts;
  const found = new Map<string, T>();
  if (unmatchedEmails.length === 0) return found;

  const { data: authUsers, error: authError } = await lookupAuthUsersByEmail(
    serviceSupabase,
    unmatchedEmails,
  );

  if (authError) {
    console.error("[resolveUnmatchedEmailsByUserId] auth lookup failed:", authError);
    return found;
  }

  if (!authUsers || authUsers.length === 0) return found;

  const userIds = authUsers.map((u) => u.id);
  const userIdToEmail = new Map(
    authUsers.map((u) => [u.id, u.email.toLowerCase()]),
  );

  const { data: linkedAlumni } = await serviceSupabase
    .from("alumni")
    .select(selectColumns)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .in("user_id", userIds);

  for (const alum of linkedAlumni ?? []) {
    const alumRecord = alum as unknown as Record<string, unknown>;
    if (!alumRecord.user_id) continue;
    const email = userIdToEmail.get(alumRecord.user_id as string);
    if (email && !existingKeys.has(email) && !found.has(email)) {
      found.set(email, buildValue(alumRecord));
    }
  }

  return found;
}

export function getResultClasses(r: ImportResultBase): { border: string; text: string } {
  if (r.updated > 0 || r.created > 0) return { border: "border-emerald-500/30 bg-emerald-500/10", text: "text-emerald-400" };
  if (r.quotaBlocked > 0) return { border: "border-amber-500/30 bg-amber-500/10", text: "text-amber-400" };
  return { border: "border-border bg-muted/50", text: "text-muted-foreground" };
}

export function summarizeRows<T extends { status: string }>(
  rows: T[],
  invalidStatuses: string[],
): ImportSummary {
  let willCreate = 0;
  let willUpdate = 0;
  let willSkip = 0;
  let quotaBlocked = 0;
  let invalid = 0;

  for (const row of rows) {
    if (row.status === "will_create") willCreate++;
    else if (row.status === "will_update") willUpdate++;
    else if (row.status === "will_skip") willSkip++;
    else if (row.status === "quota_blocked") quotaBlocked++;
    else if (invalidStatuses.includes(row.status)) invalid++;
  }

  return { willCreate, willUpdate, willSkip, quotaBlocked, invalid };
}
