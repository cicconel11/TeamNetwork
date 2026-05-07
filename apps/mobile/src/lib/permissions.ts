/**
 * Permission helpers for mobile app.
 * Re-exports permission functions from @teammeet/core with mobile-specific defaults.
 */

export {
  canViewAlumni,
  canUseAdminActions,
  canViewDonations,
  canViewRecords,
  canViewForms,
  canAccessSettings,
  canManageInvites,
  canManageBilling,
  getPermissions,
  DEFAULT_FEATURE_FLAGS,
  type FeatureFlags,
} from "@teammeet/core";

// Re-export FeatureFlags type from mobile featureFlags for backward compat
export { getFeatureFlags } from "./featureFlags";
