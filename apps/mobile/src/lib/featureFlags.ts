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
};

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
