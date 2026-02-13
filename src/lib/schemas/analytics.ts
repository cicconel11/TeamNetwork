import { z } from "zod";

// ---------------------------------------------------------------------------
// Valid feature names (derived from ORG_NAV_ITEMS hrefs)
// ---------------------------------------------------------------------------

export const VALID_FEATURES = [
  "dashboard",
  "members",
  "chat",
  "alumni",
  "mentorship",
  "workouts",
  "competition",
  "events",
  "announcements",
  "philanthropy",
  "donations",
  "expenses",
  "records",
  "calendar",
  "forms",
  "customization",
  "settings",
  "navigation",
  "other",
] as const;

export type ValidFeature = (typeof VALID_FEATURES)[number];

// ---------------------------------------------------------------------------
// Single usage event schema
// ---------------------------------------------------------------------------

export const usageEventSchema = z.object({
  event_type: z.enum(["page_view", "feature_enter", "feature_exit", "nav_click"]),
  feature: z.enum(VALID_FEATURES),
  duration_ms: z.number().int().nonnegative().optional(),
  device_class: z.enum(["mobile", "tablet", "desktop"]),
  hour_of_day: z.number().int().min(0).max(23),
});

export type UsageEventInput = z.infer<typeof usageEventSchema>;

// ---------------------------------------------------------------------------
// Ingest request schema (batched)
// ---------------------------------------------------------------------------

export const usageIngestRequestSchema = z.object({
  events: z.array(usageEventSchema).min(1).max(50),
  session_id: z.string().min(1).max(100),
  organization_id: z.string().uuid().optional(),
});

export type UsageIngestRequestInput = z.infer<typeof usageIngestRequestSchema>;

// ---------------------------------------------------------------------------
// Consent update schema
// ---------------------------------------------------------------------------

export const consentUpdateSchema = z.object({
  consented: z.boolean(),
});

export type ConsentUpdateInput = z.infer<typeof consentUpdateSchema>;

// ---------------------------------------------------------------------------
// Custom analytics events (behavioral + ops)
// ---------------------------------------------------------------------------

const analyticsCommonFieldsSchema = z.object({
  org_id: z.string().uuid().nullable().optional(),
  session_id: z.string().min(1).max(100),
  client_day: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/),
  platform: z.enum(["web", "ios", "android", "desktop"]),
  device_class: z.enum(["mobile", "tablet", "desktop"]),
  app_version: z.string().max(50),
  route: z.string().max(2000),
  referrer_type: z.enum(["direct", "invite_link", "deeplink", "notification", "email_link"]),
  consent_state: z.enum(["opted_out", "opted_in", "unknown"]),
});

const appOpenPayloadSchema = analyticsCommonFieldsSchema;

const routeViewPayloadSchema = analyticsCommonFieldsSchema.extend({
  screen: z.string().max(200),
  feature: z.string().max(200),
});

const navClickPayloadSchema = analyticsCommonFieldsSchema.extend({
  destination_route: z.string().max(2000),
  nav_surface: z.string().max(100),
  position: z.number().int().nonnegative(),
});

const ctaClickPayloadSchema = analyticsCommonFieldsSchema.extend({
  cta: z.string().max(200),
  feature: z.string().max(200),
  surface: z.string().max(100),
  position: z.number().int().nonnegative(),
});

const pageDwellPayloadSchema = analyticsCommonFieldsSchema.extend({
  screen: z.string().max(200),
  feature: z.string().max(200),
  dwell_bucket: z.enum(["0-5s", "6-15s", "16-30s", "31-60s", "61-180s", "180s+"]),
});

const signupPayloadSchema = analyticsCommonFieldsSchema.extend({
  signup_method: z.enum(["magic_link", "oauth_google", "oauth_apple", "invite_code"]),
});

const inviteCodeSubmitPayloadSchema = analyticsCommonFieldsSchema.extend({
  result: z.enum(["success", "invalid", "expired", "already_used"]),
});

const onboardingStepPayloadSchema = analyticsCommonFieldsSchema.extend({
  step: z.string().max(100),
  result: z.string().max(50).optional(),
});

const directoryViewPayloadSchema = analyticsCommonFieldsSchema.extend({
  directory_type: z.enum(["active_members", "alumni"]),
});

const directoryFilterPayloadSchema = analyticsCommonFieldsSchema.extend({
  directory_type: z.enum(["active_members", "alumni"]),
  filter_keys: z.array(z.string().max(50)).max(50),
  filters_count: z.number().int().nonnegative(),
});

const directorySortPayloadSchema = analyticsCommonFieldsSchema.extend({
  directory_type: z.enum(["active_members", "alumni"]),
  sort_key: z.string().max(50),
});

const profileCardPayloadSchema = analyticsCommonFieldsSchema.extend({
  directory_type: z.enum(["active_members", "alumni"]),
  open_source: z.enum(["list", "search_results", "deep_link"]),
});

const eventsViewPayloadSchema = analyticsCommonFieldsSchema.extend({
  view_mode: z.enum(["upcoming", "past", "calendar"]),
});

const eventOpenPayloadSchema = analyticsCommonFieldsSchema.extend({
  event_id: z.string().uuid(),
  open_source: z.enum(["list", "search_results", "deep_link"]).optional(),
});

const rsvpUpdatePayloadSchema = analyticsCommonFieldsSchema.extend({
  event_id: z.string().uuid(),
  rsvp_status: z.enum(["going", "maybe", "not_going"]),
});

const eventCreateAttemptPayloadSchema = analyticsCommonFieldsSchema.extend({
  result: z.enum(["success", "fail_validation", "fail_server"]),
  error_code: z.string().max(100).optional(),
});

const scheduleSourceAddPayloadSchema = analyticsCommonFieldsSchema.extend({
  vendor_type: z.enum(["manual", "ics", "sectionxi", "chsaa", "other_vendor"]),
  result: z.string().max(50).optional(),
  error_code: z.string().max(100).optional(),
});

const scheduleSyncPayloadSchema = analyticsCommonFieldsSchema.extend({
  vendor_type: z.enum(["manual", "ics", "sectionxi", "chsaa", "other_vendor"]),
  result: z.string().max(50),
  items_loaded_bucket: z.enum(["0", "1-5", "6-20", "21-100", "100+"]),
  duration_bucket: z.enum(["<1s", "1-3s", "3-10s", "10-30s", "30s+"]),
  error_code: z.string().max(100).optional(),
});

const formOpenPayloadSchema = analyticsCommonFieldsSchema.extend({
  form_id: z.string().uuid(),
  open_source: z.enum(["list", "search_results", "deep_link"]).optional(),
});

const formSubmitPayloadSchema = analyticsCommonFieldsSchema.extend({
  form_id: z.string().uuid(),
  result: z.enum(["success", "fail_validation", "fail_server"]),
  duration_bucket: z.enum(["<1s", "1-3s", "3-10s", "10-30s", "30s+"]),
  error_code: z.string().max(100).optional(),
});

const fileUploadPayloadSchema = analyticsCommonFieldsSchema.extend({
  file_type: z.enum(["image", "pdf", "doc", "other"]),
  file_size_bucket: z.enum(["<1MB", "1-5MB", "5-25MB", "25MB+"]),
  result: z.enum(["success", "fail_validation", "fail_server"]),
  error_code: z.string().max(100).optional(),
});

const donationFlowPayloadSchema = analyticsCommonFieldsSchema.extend({
  campaign_id: z.string().max(100).optional(),
});

const donationCheckoutStartPayloadSchema = analyticsCommonFieldsSchema.extend({
  campaign_id: z.string().max(100).optional(),
  amount_bucket: z.enum(["<10", "10-25", "26-50", "51-100", "101-250", "250+"]),
});

const donationCheckoutResultPayloadSchema = analyticsCommonFieldsSchema.extend({
  campaign_id: z.string().max(100).optional(),
  result: z.enum(["success", "cancel", "fail"]),
  error_code: z.string().max(100).optional(),
});

const chatThreadOpenPayloadSchema = analyticsCommonFieldsSchema.extend({
  thread_id: z.string().max(100),
  open_source: z.enum(["list", "search_results", "deep_link"]).optional(),
});

const chatMessagePayloadSchema = analyticsCommonFieldsSchema.extend({
  thread_id: z.string().max(100),
  message_type: z.enum(["text", "image", "file"]),
  result: z.enum(["success", "fail_validation", "fail_server"]),
  error_code: z.string().max(100).optional(),
});

const chatParticipantsPayloadSchema = analyticsCommonFieldsSchema.extend({
  thread_id: z.string().max(100),
  action: z.enum(["add", "remove"]),
  delta_count: z.number().int().nonnegative(),
  result: z.string().max(50).optional(),
});

export const analyticsEventSchema = z.discriminatedUnion("event_name", [
  z.object({ event_name: z.literal("app_open"), payload: appOpenPayloadSchema }),
  z.object({ event_name: z.literal("route_view"), payload: routeViewPayloadSchema }),
  z.object({ event_name: z.literal("nav_click"), payload: navClickPayloadSchema }),
  z.object({ event_name: z.literal("cta_click"), payload: ctaClickPayloadSchema }),
  z.object({ event_name: z.literal("page_dwell_bucket"), payload: pageDwellPayloadSchema }),
  z.object({ event_name: z.literal("signup_start"), payload: signupPayloadSchema }),
  z.object({ event_name: z.literal("signup_complete"), payload: signupPayloadSchema }),
  z.object({ event_name: z.literal("invite_code_submit"), payload: inviteCodeSubmitPayloadSchema }),
  z.object({ event_name: z.literal("onboarding_step_complete"), payload: onboardingStepPayloadSchema }),
  z.object({ event_name: z.literal("directory_view"), payload: directoryViewPayloadSchema }),
  z.object({ event_name: z.literal("directory_filter_apply"), payload: directoryFilterPayloadSchema }),
  z.object({ event_name: z.literal("directory_sort_change"), payload: directorySortPayloadSchema }),
  z.object({ event_name: z.literal("profile_card_open"), payload: profileCardPayloadSchema }),
  z.object({ event_name: z.literal("events_view"), payload: eventsViewPayloadSchema }),
  z.object({ event_name: z.literal("event_open"), payload: eventOpenPayloadSchema }),
  z.object({ event_name: z.literal("rsvp_update"), payload: rsvpUpdatePayloadSchema }),
  z.object({ event_name: z.literal("event_create_attempt"), payload: eventCreateAttemptPayloadSchema }),
  z.object({ event_name: z.literal("schedule_source_add"), payload: scheduleSourceAddPayloadSchema }),
  z.object({ event_name: z.literal("schedule_sync_run"), payload: scheduleSyncPayloadSchema }),
  z.object({ event_name: z.literal("form_open"), payload: formOpenPayloadSchema }),
  z.object({ event_name: z.literal("form_submit"), payload: formSubmitPayloadSchema }),
  z.object({ event_name: z.literal("file_upload_attempt"), payload: fileUploadPayloadSchema }),
  z.object({ event_name: z.literal("donation_flow_start"), payload: donationFlowPayloadSchema }),
  z.object({ event_name: z.literal("donation_checkout_start"), payload: donationCheckoutStartPayloadSchema }),
  z.object({ event_name: z.literal("donation_checkout_result"), payload: donationCheckoutResultPayloadSchema }),
  z.object({ event_name: z.literal("chat_thread_open"), payload: chatThreadOpenPayloadSchema }),
  z.object({ event_name: z.literal("chat_message_send"), payload: chatMessagePayloadSchema }),
  z.object({ event_name: z.literal("chat_participants_change"), payload: chatParticipantsPayloadSchema }),
]);

export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;

const opsCommonFieldsSchema = analyticsCommonFieldsSchema.extend({
  org_id: z.string().uuid().nullable().optional(),
});

const apiErrorPayloadSchema = opsCommonFieldsSchema.extend({
  endpoint_group: z.enum(["auth", "directory", "events", "forms", "chat", "donations", "schedule", "admin"]),
  http_status: z.number().int().min(100).max(599),
  error_code: z.string().max(100).optional(),
  retryable: z.boolean().optional(),
});

const clientErrorPayloadSchema = opsCommonFieldsSchema.extend({
  error_surface: z.enum(["page", "modal", "background_task"]),
  error_code: z.string().max(100).optional(),
});

export const analyticsOpsEventSchema = z.discriminatedUnion("event_name", [
  z.object({ event_name: z.literal("api_error"), payload: apiErrorPayloadSchema }),
  z.object({ event_name: z.literal("client_error"), payload: clientErrorPayloadSchema }),
]);

export type AnalyticsOpsEventInput = z.infer<typeof analyticsOpsEventSchema>;

// ---------------------------------------------------------------------------
// UI Profile schema (validated LLM output)
// ---------------------------------------------------------------------------

export const dashboardHintsSchema = z.object({
  show_recent_features: z.boolean(),
  suggested_features: z.array(z.string()).max(10),
  preferred_time_label: z.string().max(200),
});

export const uiProfileSchema = z.object({
  nav_order: z.array(z.string()).max(30),
  feature_highlights: z.array(z.string()).max(10),
  dashboard_hints: dashboardHintsSchema,
});

export type UIProfileOutput = z.infer<typeof uiProfileSchema>;
