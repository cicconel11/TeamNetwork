import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type OrgRoleConfigColumn =
  | "feed_post_roles"
  | "discussion_post_roles"
  | "job_post_roles";

export const DEFAULT_ORG_ROLE_CONFIG: Record<OrgRoleConfigColumn, string[]> = {
  feed_post_roles: ["admin", "active_member", "alumni"],
  discussion_post_roles: ["admin", "active_member", "alumni", "parent"],
  job_post_roles: ["admin", "alumni"],
};

export async function getAllowedOrgRoles(
  supabase: SupabaseClient<Database>,
  orgId: string,
  column: OrgRoleConfigColumn,
  context: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select(column)
    .eq("id", orgId)
    .maybeSingle();

  if (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
    throw new Error(`[${context}] Failed to fetch org config: ${message}`);
  }

  if (!data) {
    throw new Error(`[${context}] Organization config not found for org ${orgId}`);
  }

  const value = (data as Record<string, unknown>)[column];
  return Array.isArray(value) ? (value as string[]) : DEFAULT_ORG_ROLE_CONFIG[column];
}
