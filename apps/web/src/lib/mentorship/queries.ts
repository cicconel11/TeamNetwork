import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MENTORSHIP_MENTEE_ROLES,
  MENTORSHIP_MENTOR_ROLES,
  memberDisplayLabel,
  partitionPairableOrgMembers,
  type PairableOrgMember,
  type PairableOrgMemberRow,
} from "@teammeet/core";

interface PairableMembers {
  mentors: PairableOrgMember[];
  mentees: PairableOrgMember[];
}

export async function getPairableOrgMembers(
  supabase: SupabaseClient,
  orgId: string
): Promise<PairableMembers> {
  const { data, error } = await supabase
    .from("user_organization_roles")
    .select("user_id, role, users(name, email)")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .in("role", [...MENTORSHIP_MENTOR_ROLES, ...MENTORSHIP_MENTEE_ROLES]);

  if (error) {
    throw new Error(`Failed to load pairable org members: ${error.message}`);
  }

  return partitionPairableOrgMembers((data ?? []) as PairableOrgMemberRow[]);
}

export { memberDisplayLabel };
