/**
 * Analytics event type definitions
 */

// Property value types that PostHog accepts
type PropertyValue = string | number | boolean | null | undefined;

export interface AnalyticsConfig {
  posthogKey: string;
  sentryDsn: string;
}

export interface UserTraits {
  email?: string;
  authProvider?: string;
  [key: string]: PropertyValue;
}

export interface UserProperties {
  currentOrgSlug?: string;
  currentOrgId?: string;
  // Normalized, low-cardinality role for analytics
  role?: "admin" | "member" | "alumni" | "unknown";
  [key: string]: PropertyValue;
}

export interface ScreenProperties {
  pathname?: string;
  [key: string]: PropertyValue;
}

export interface EventProperties {
  [key: string]: PropertyValue;
}

export type QueuedEvent =
  | { type: "identify"; userId: string; traits?: UserTraits }
  | { type: "setUserProperties"; properties: UserProperties }
  | { type: "screen"; name: string; properties?: ScreenProperties }
  | { type: "track"; event: string; properties?: EventProperties };
