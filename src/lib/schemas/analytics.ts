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
  "schedules",
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
