// Auth - Role utilities and permissions
export { normalizeRole, roleFlags, type OrgRole } from "./auth/index";
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
} from "./auth/index";

// Pricing - Subscription pricing and alumni quotas
export {
  BASE_PRICES,
  ALUMNI_ADD_ON_PRICES,
  ALUMNI_BUCKET_LABELS,
  ALUMNI_LIMITS,
  getTotalPrice,
  formatPrice,
  getAlumniLimit,
  normalizeBucket,
} from "./pricing/index";

// Announcements - Audience filtering
export { filterAnnouncementsForUser, type ViewerContext } from "./announcements/index";

// Formatters - Display formatting utilities
export {
  getRsvpLabel,
  RSVP_LABELS,
  formatEventDate,
  formatEventTime,
  formatEventDateTime,
  formatRelativeDate,
  formatAnnouncementDate,
} from "./formatters/index";
