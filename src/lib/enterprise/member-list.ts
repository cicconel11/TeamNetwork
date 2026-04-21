export interface OrgAdminScopeRow {
  organization_id: string;
  role?: string | null;
  status?: string | null;
}

export interface EnterpriseMemberUserRow {
  id: string;
  email: string | null;
  name: string | null;
}

export interface EnterpriseMemberRoleRow {
  user_id: string;
  organization_id: string;
  role: string;
  status?: string | null;
}

export interface EnterpriseOrganizationRow {
  id: string;
  name: string;
  slug: string;
}

export interface EnterpriseMemberInfo {
  userId: string;
  email: string;
  fullName: string;
  organizations: Array<{
    orgId: string;
    orgName: string;
    orgSlug: string;
    role: string;
  }>;
}

export function getActiveAdminOrgIds(
  rows: OrgAdminScopeRow[] | null | undefined
): string[] {
  const scopedOrgIds: string[] = [];
  const seen = new Set<string>();

  for (const row of rows ?? []) {
    if (!row.organization_id || seen.has(row.organization_id)) {
      continue;
    }

    if ((row.role == null || row.role === "admin") && row.status === "active") {
      seen.add(row.organization_id);
      scopedOrgIds.push(row.organization_id);
    }
  }

  return scopedOrgIds;
}

export function paginateEnterpriseMemberUsers(
  users: EnterpriseMemberUserRow[],
  limit: number
): {
  users: EnterpriseMemberUserRow[];
  nextCursor: string | null;
} {
  const hasMore = users.length > limit;
  const trimmed = users.slice(0, limit);
  return {
    users: trimmed,
    nextCursor: hasMore && trimmed.length > 0 ? trimmed[trimmed.length - 1].id : null,
  };
}

export function buildEnterpriseMembers(
  users: EnterpriseMemberUserRow[],
  roles: EnterpriseMemberRoleRow[],
  organizations: EnterpriseOrganizationRow[]
): EnterpriseMemberInfo[] {
  const organizationsById = new Map(
    organizations.map((organization) => [organization.id, organization])
  );
  const rolesByUserId = new Map<string, EnterpriseMemberRoleRow[]>();

  for (const role of roles) {
    const existing = rolesByUserId.get(role.user_id) ?? [];
    existing.push(role);
    rolesByUserId.set(role.user_id, existing);
  }

  return users.map((user) => ({
    userId: user.id,
    email: user.email ?? "",
    fullName: user.name ?? "",
    organizations: (rolesByUserId.get(user.id) ?? [])
      .map((role) => {
        const organization = organizationsById.get(role.organization_id);
        if (!organization) return null;

        return {
          orgId: organization.id,
          orgName: organization.name,
          orgSlug: organization.slug,
          role: role.role,
        };
      })
      .filter((organization): organization is NonNullable<typeof organization> => organization !== null),
  }));
}
