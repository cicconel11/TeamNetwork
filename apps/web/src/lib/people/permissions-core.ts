export type OrgRoleLabel = "Admin" | "Member" | "Alumni" | "Parent";

export interface PersonAdminContext {
  adminUserIds: Set<string>;
  /** True when the viewer is an org admin. */
  isAdmin: boolean;
  /**
   * Returns true when the viewer can edit the row owned by `targetUserId`.
   *
   * Semantics:
   *   if (!viewerUserId || !targetUserId) return isAdmin;
   *   else return isAdmin || viewerUserId === targetUserId;
   *
   * The null-target branch MUST return isAdmin only — never treat
   * `null === null` as a self-edit on manual rows that have no user_id.
   */
  canEditPerson(targetUserId: string | null | undefined): boolean;
  isReadOnly: boolean;
  orgRoleLabelFor(userId: string | null | undefined): OrgRoleLabel | null;
}

const ORG_ROLE_LABEL: Record<string, OrgRoleLabel> = {
  admin: "Admin",
  active_member: "Member",
  alumni: "Alumni",
  parent: "Parent",
};

export interface BuildPersonAdminContextInput {
  viewerUserId: string | null;
  isAdmin: boolean;
  isReadOnly: boolean;
  /** Active org-role rows for this organization. */
  roleRows: Array<{ user_id: string | null; role: string | null }>;
}

/**
 * Pure builder used by `getPersonAdminContext`. Holds the canEditPerson +
 * orgRoleLabelFor invariants and is unit-testable without a database.
 */
export function buildPersonAdminContext(
  input: BuildPersonAdminContextInput,
): PersonAdminContext {
  const { viewerUserId, isAdmin, isReadOnly, roleRows } = input;

  const roleByUserId = new Map<string, string>();
  const adminUserIds = new Set<string>();
  for (const row of roleRows) {
    if (!row.user_id || !row.role) continue;
    roleByUserId.set(row.user_id, row.role);
    if (row.role === "admin") adminUserIds.add(row.user_id);
  }

  const canEditPerson = (targetUserId: string | null | undefined): boolean => {
    if (!viewerUserId || !targetUserId) return isAdmin;
    return isAdmin || viewerUserId === targetUserId;
  };

  const orgRoleLabelFor = (userId: string | null | undefined): OrgRoleLabel | null => {
    if (!userId) return null;
    const role = roleByUserId.get(userId);
    if (!role) return null;
    return ORG_ROLE_LABEL[role] ?? null;
  };

  return { adminUserIds, isAdmin, canEditPerson, isReadOnly, orgRoleLabelFor };
}
