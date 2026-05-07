import { isOrgAdmin } from "@/lib/auth";
import { checkOrgReadOnly } from "@/lib/subscription/read-only-guard";
import { createClient } from "@/lib/supabase/server";
import {
  buildPersonAdminContext,
  type PersonAdminContext,
} from "./permissions-core";

export {
  buildPersonAdminContext,
  type PersonAdminContext,
  type OrgRoleLabel,
  type BuildPersonAdminContextInput,
} from "./permissions-core";

/**
 * Single source of truth for "who can edit this person?" + "what badge do
 * we render for this person's org role?" used by Members / Alumni / Parents
 * directories and detail pages.
 *
 * Invariants:
 *  - `viewerUserId` MUST come from `supabase.auth.getUser()` server-side.
 *    Passing a URL- or props-derived id is a security bug.
 *  - `canEditPerson(null)` returns `isAdmin` only — never grants self-edit
 *    on manual rows by collapsing `null === null`.
 *
 * Performance: the per-row org-role lookup is memoized inside the returned
 * context so repeated `orgRoleLabelFor(userId)` calls across a directory
 * row list issue a single query for the whole org's role table, not N+1.
 */
export async function getPersonAdminContext(params: {
  orgId: string;
  viewerUserId: string | null;
}): Promise<PersonAdminContext> {
  const { orgId, viewerUserId } = params;

  const supabase = await createClient();

  const [adminFlag, { isReadOnly }, rolesResult] = await Promise.all([
    isOrgAdmin(orgId),
    checkOrgReadOnly(orgId),
    supabase
      .from("user_organization_roles")
      .select("user_id, role, status")
      .eq("organization_id", orgId)
      .eq("status", "active"),
  ]);

  return buildPersonAdminContext({
    viewerUserId,
    isAdmin: adminFlag,
    isReadOnly,
    roleRows: (rolesResult.data ?? []) as Array<{ user_id: string | null; role: string | null }>,
  });
}
