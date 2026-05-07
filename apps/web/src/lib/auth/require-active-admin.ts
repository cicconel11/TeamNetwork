import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { normalizeRole } from "./role-utils";

export type ActiveAdminReason = "missing" | "not_admin" | "inactive" | "error";

export type ActiveAdminResult =
  | { ok: true }
  | { ok: false; reason: ActiveAdminReason };

/**
 * Single source of truth for "is caller an active admin in this org?".
 *
 * Caller must pass an SSR-scoped Supabase client. RLS on
 * user_organization_roles allows a user to read their own row regardless of
 * status, so an SSR client is sufficient and keeps the query scoped to
 * (user_id, organization_id).
 */
export async function getActiveAdminMembership(
  client: SupabaseClient<Database>,
  userId: string,
  orgId: string
): Promise<ActiveAdminResult> {
  const { data, error } = await client
    .from("user_organization_roles")
    .select("role, status")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) return { ok: false, reason: "error" };
  if (!data) return { ok: false, reason: "missing" };

  const role = normalizeRole(data.role);
  if (role !== "admin") return { ok: false, reason: "not_admin" };
  if (data.status !== "active") return { ok: false, reason: "inactive" };

  return { ok: true };
}

export async function requireActiveOrgAdmin(
  client: SupabaseClient<Database>,
  userId: string,
  orgId: string
): Promise<boolean> {
  const result = await getActiveAdminMembership(client, userId, orgId);
  return result.ok;
}
