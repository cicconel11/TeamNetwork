/**
 * Permission helpers for role-based access control.
 * These functions determine what actions users can perform based on their role
 * and feature flag states.
 *
 * Note: These are pure functions that require flags as parameters.
 * Platform-specific wrappers (mobile, web) can provide defaults.
 */

import type { OrgRole } from "./role-utils";

/**
 * Feature flags that control access to optional modules.
 */
export interface FeatureFlags {
  alumniEnabled: boolean;
  donationsEnabled: boolean;
  recordsEnabled: boolean;
  formsEnabled: boolean;
}

/**
 * Default feature flags - all disabled.
 */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  alumniEnabled: false,
  donationsEnabled: false,
  recordsEnabled: false,
  formsEnabled: false,
};

/**
 * Check if a user can view the alumni directory.
 * Alumni viewing requires:
 * 1. The alumniEnabled feature flag to be true (org-level setting)
 * 2. The user to have any valid org role (admin, active_member, or alumni)
 *
 * @param viewerRole - The role of the current user
 * @param flags - Feature flags (partial, defaults used for missing)
 * @returns Whether the user can view alumni
 */
export function canViewAlumni(
  viewerRole: OrgRole | null,
  flags?: Partial<FeatureFlags>
): boolean {
  if (!viewerRole) return false;
  const resolvedFlags = { ...DEFAULT_FEATURE_FLAGS, ...flags };
  if (!resolvedFlags.alumniEnabled) return false;
  return true;
}

/**
 * Check if a user can use admin actions (create/edit/delete).
 *
 * @param viewerRole - The role of the current user
 * @returns Whether the user can use admin actions
 */
export function canUseAdminActions(viewerRole: OrgRole | null): boolean {
  return viewerRole === "admin";
}

/**
 * Check if a user can view the donations module.
 *
 * @param viewerRole - The role of the current user
 * @param flags - Feature flags (partial, defaults used for missing)
 * @returns Whether the user can view donations
 */
export function canViewDonations(
  viewerRole: OrgRole | null,
  flags?: Partial<FeatureFlags>
): boolean {
  if (!viewerRole) return false;
  const resolvedFlags = { ...DEFAULT_FEATURE_FLAGS, ...flags };
  return resolvedFlags.donationsEnabled;
}

/**
 * Check if a user can view the records module.
 *
 * @param viewerRole - The role of the current user
 * @param flags - Feature flags (partial, defaults used for missing)
 * @returns Whether the user can view records
 */
export function canViewRecords(
  viewerRole: OrgRole | null,
  flags?: Partial<FeatureFlags>
): boolean {
  if (!viewerRole) return false;
  const resolvedFlags = { ...DEFAULT_FEATURE_FLAGS, ...flags };
  return resolvedFlags.recordsEnabled;
}

/**
 * Check if a user can view the forms module.
 *
 * @param viewerRole - The role of the current user
 * @param flags - Feature flags (partial, defaults used for missing)
 * @returns Whether the user can view forms
 */
export function canViewForms(
  viewerRole: OrgRole | null,
  flags?: Partial<FeatureFlags>
): boolean {
  if (!viewerRole) return false;
  const resolvedFlags = { ...DEFAULT_FEATURE_FLAGS, ...flags };
  return resolvedFlags.formsEnabled;
}

/**
 * Check if the user can access admin settings.
 * Only admins can access organization settings.
 *
 * @param viewerRole - The role of the current user
 * @returns Whether the user can access admin settings
 */
export function canAccessSettings(viewerRole: OrgRole | null): boolean {
  return viewerRole === "admin";
}

/**
 * Check if the user can manage invites.
 * Only admins can send invites.
 *
 * @param viewerRole - The role of the current user
 * @returns Whether the user can manage invites
 */
export function canManageInvites(viewerRole: OrgRole | null): boolean {
  return viewerRole === "admin";
}

/**
 * Check if the user can manage billing.
 * Only admins can manage billing.
 *
 * @param viewerRole - The role of the current user
 * @returns Whether the user can manage billing
 */
export function canManageBilling(viewerRole: OrgRole | null): boolean {
  return viewerRole === "admin";
}

/**
 * Get a summary of all permissions for a user.
 * Useful for debugging and displaying UI states.
 *
 * @param viewerRole - The role of the current user
 * @param flags - Feature flags (partial, defaults used for missing)
 * @returns Object with all permission values
 */
export function getPermissions(
  viewerRole: OrgRole | null,
  flags?: Partial<FeatureFlags>
) {
  return {
    canViewAlumni: canViewAlumni(viewerRole, flags),
    canUseAdminActions: canUseAdminActions(viewerRole),
    canViewDonations: canViewDonations(viewerRole, flags),
    canViewRecords: canViewRecords(viewerRole, flags),
    canViewForms: canViewForms(viewerRole, flags),
    canAccessSettings: canAccessSettings(viewerRole),
    canManageInvites: canManageInvites(viewerRole),
    canManageBilling: canManageBilling(viewerRole),
  };
}
