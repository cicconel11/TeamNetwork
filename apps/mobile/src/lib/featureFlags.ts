/**
 * Feature flags for mobile app.
 * These control visibility and access to features that may not be ready
 * for all users or are gated behind certain conditions.
 */

export interface FeatureFlags {
  /** Enable alumni directory feature */
  alumniEnabled: boolean;
  /** Enable donations module */
  donationsEnabled: boolean;
  /** Enable records module */
  recordsEnabled: boolean;
  /** Enable forms module */
  formsEnabled: boolean;
  /** iOS Live Activities for events. Build-time gate via EXPO_PUBLIC_MOBILE_LIVE_ACTIVITIES_ENABLED. */
  liveActivitiesEnabled: boolean;
}

/**
 * Default feature flags - all features disabled by default.
 * In production, these would be fetched from a remote config service
 * or determined by organization settings.
 */
export const defaultFeatureFlags: FeatureFlags = {
  alumniEnabled: false,
  donationsEnabled: false,
  recordsEnabled: false,
  formsEnabled: false,
  liveActivitiesEnabled: false,
};

/**
 * Read the build-time Live Activities flag. Default off so older builds that
 * pre-date the widget extension never try to call ActivityKit (which would
 * crash on missing entitlement). Server-side eligibility is gated separately
 * through `/api/live-activity/eligibility` so we can kill-switch without an
 * app rebuild.
 */
function readLiveActivitiesBuildFlag(): boolean {
  const raw = process.env.EXPO_PUBLIC_MOBILE_LIVE_ACTIVITIES_ENABLED;
  if (typeof raw !== "string") return false;
  return raw.toLowerCase() === "true" || raw === "1";
}

/**
 * Get feature flags for an organization.
 * Returns defaults - all features disabled unless explicitly enabled.
 * 
 * To enable a feature for an org, this function should be extended to:
 * - Fetch from organization settings in Supabase (e.g., org.features_enabled jsonb column)
 * - Use a remote config service (Firebase Remote Config, LaunchDarkly, etc.)
 * - Cache in AsyncStorage for offline access
 * 
 * @param _orgId - Organization ID (unused until backend integration)
 * @returns Feature flags with all features disabled by default
 */
export function getFeatureFlags(_orgId?: string): FeatureFlags {
  // Enable alumni in dev builds only for testing; prod stays off until validated
  const flags = { ...defaultFeatureFlags };
  if (__DEV__) {
    flags.alumniEnabled = true;
  }
  flags.liveActivitiesEnabled = readLiveActivitiesBuildFlag();
  return flags;
}

/**
 * Check if a specific feature is enabled
 */
export function isFeatureEnabled(
  flag: keyof FeatureFlags,
  orgId?: string
): boolean {
  const flags = getFeatureFlags(orgId);
  return flags[flag];
}
