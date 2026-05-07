import type { OrgRole } from "@teammeet/core";

export function getEditParentRedirectPath(params: {
  orgSlug: string;
  orgId: string | null;
  parentId: string | undefined;
  hasParentsAccess: boolean;
}): string | null {
  const { orgSlug, orgId, parentId, hasParentsAccess } = params;

  if (orgId && parentId && hasParentsAccess) {
    return null;
  }

  return orgSlug ? `/(app)/${orgSlug}/parents` : "/(app)";
}

export function canEditParentRecord(params: {
  role: OrgRole | null;
  currentUserId: string | null | undefined;
  parentUserId: string | null;
}): boolean {
  const { role, currentUserId, parentUserId } = params;

  return role === "admin" || (role === "parent" && parentUserId === currentUserId);
}
