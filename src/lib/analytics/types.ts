/**
 * Shared types for the usage analytics system.
 *
 * This file defines the core interfaces used across:
 * - Client-side event capture
 * - Server-side ingestion / aggregation
 * - LLM-driven UI profile generation
 */

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type EventType = "page_view" | "feature_enter" | "feature_exit" | "nav_click";

export type DeviceClass = "mobile" | "tablet" | "desktop";

export type AgeBracket = "under_13" | "13_17" | "18_plus";

export type OrgType = "educational" | "athletic" | "general";

/** Shape of a single usage event sent from the client to the ingest API. */
export interface UsageEvent {
  event_type: EventType;
  feature: string;
  duration_ms?: number;
  device_class: DeviceClass;
  hour_of_day: number;
  /** Internal: org ID stamped at capture time to prevent misattribution across org navigations. */
  _organization_id?: string;
}

/** Full ingest request payload (batched events). */
export interface UsageIngestRequest {
  events: UsageEvent[];
  session_id: string;
  organization_id?: string;
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export interface AnalyticsConsentRow {
  id: string;
  user_id: string;
  consented: boolean;
  age_bracket: AgeBracket | null;
  consented_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export interface UsageSummary {
  id: string;
  user_id: string;
  organization_id: string;
  feature: string;
  visit_count: number;
  total_duration_ms: number;
  last_visited_at: string | null;
  peak_hour: number | null;
  device_preference: string | null;
  period_start: string;
  period_end: string;
}

// ---------------------------------------------------------------------------
// UI Profile (LLM-generated)
// ---------------------------------------------------------------------------

export interface DashboardHints {
  show_recent_features: boolean;
  suggested_features: string[];
  preferred_time_label: string;
}

export interface UIProfile {
  nav_order: string[];
  feature_highlights: string[];
  dashboard_hints: DashboardHints;
}

export interface UIProfileRow {
  id: string;
  user_id: string;
  organization_id: string;
  profile: UIProfile;
  summary_hash: string;
  llm_provider: string | null;
  generated_at: string;
  expires_at: string;
}

// ---------------------------------------------------------------------------
// LLM Adapter
// ---------------------------------------------------------------------------

export interface ProfileInput {
  summaries: UsageSummary[];
  availableFeatures: string[];
  userRole: string;
  orgType: string;
}
