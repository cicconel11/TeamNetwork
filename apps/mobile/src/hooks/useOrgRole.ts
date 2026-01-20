/**
 * Hook to get the current user's organization role with convenience flags.
 * This provides a single source of truth for role-based UI decisions.
 */

import { useMemo } from "react";
import { useOrg } from "@/contexts/OrgContext";
import { roleFlags, type OrgRole } from "@teammeet/core";
import { getFeatureFlags, type FeatureFlags } from "@/lib/featureFlags";
import { getPermissions } from "@/lib/permissions";

export interface UseOrgRoleResult {
  /** The raw normalized role */
  role: OrgRole | null;
  /** Whether the user is an admin */
  isAdmin: boolean;
  /** Whether the user is an active member */
  isActiveMember: boolean;
  /** Whether the user is an alumni */
  isAlumni: boolean;
  /** Whether the role is still loading */
  isLoading: boolean;
  /** Current feature flags */
  featureFlags: FeatureFlags;
  /** All computed permissions */
  permissions: ReturnType<typeof getPermissions>;
}

/**
 * Hook to access the current user's role and permissions within an organization.
 * Must be used within an OrgProvider.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isAdmin, permissions } = useOrgRole();
 *
 *   if (permissions.canViewAlumni) {
 *     return <AlumniList />;
 *   }
 *
 *   return <MembersOnly />;
 * }
 * ```
 */
export function useOrgRole(): UseOrgRoleResult {
  const { userRole, isLoading, orgId } = useOrg();

  return useMemo(() => {
    const flags = roleFlags(userRole);
    const featureFlags = getFeatureFlags(orgId ?? undefined);
    const permissions = getPermissions(userRole, featureFlags);

    return {
      role: userRole,
      isAdmin: flags.isAdmin,
      isActiveMember: flags.isActiveMember,
      isAlumni: flags.isAlumni,
      isLoading,
      featureFlags,
      permissions,
    };
  }, [userRole, isLoading, orgId]);
}
