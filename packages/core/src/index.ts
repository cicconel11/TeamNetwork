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
export {
  canViewAnnouncement,
  filterAnnouncementsForUser,
  type AnnouncementAudienceTarget,
  type ViewerContext,
} from "./announcements/index";

// Formatters - Display formatting utilities
export {
  getRsvpLabel,
  RSVP_LABELS,
  normalizeRsvpStatus,
  type RsvpStatus,
  formatEventDate,
  formatEventTime,
  formatEventDateTime,
  formatRelativeDate,
  formatAnnouncementDate,
} from "./formatters/index";

// Marketing - Shared landing-page copy and demo data
export {
  BRAND_TAGLINE,
  HERO_SUB_COPY,
  DEMO_ORG,
  FEATURES,
  type MarketingFeature,
  type DemoOrgRow,
  type DemoOrgStats,
  type DemoOrg,
} from "./marketing/index";

// Mentorship - Shared pairing and presentation rules
export {
  MENTORSHIP_MENTOR_ROLES,
  MENTORSHIP_MENTEE_ROLES,
  memberDisplayLabel,
  partitionPairableOrgMembers,
  getMentorshipSectionOrder,
  getVisibleMentorshipPairs,
  isUserInMentorshipPair,
  normalizeMentorshipStatus,
  type MentorshipStatus,
  type MentorshipPairSummary,
  type PairableOrgMember,
  type PairableOrgMemberRow,
} from "./mentorship/index";

// APNs client lives at "@teammeet/core/apns" — server-only (uses node:buffer/jose).
// Do not re-export from this barrel; mobile bundler cannot resolve node:buffer.
