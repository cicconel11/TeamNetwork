/**
 * Biometric unlock helpers (R5).
 *
 * Storage: a single SecureStore key holds the user's opt-in. We deliberately do
 * not persist `biometric_enabled` to Supabase for v1 — the setting is
 * device-scoped (a user with biometrics on their phone may not want it on a
 * shared tablet), and SecureStore is the natural home. A `user_app_preferences`
 * table can land later when we need cross-device sync (deferred).
 *
 * Re-enrollment behaviour: on iOS we rely on `LocalAuthentication.authenticateAsync`
 * itself — when the enrolled biometric set changes, the OS surfaces an error
 * which we treat as "lock + force password re-auth" by clearing the flag.
 */

import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const BIOMETRIC_ENABLED_KEY = "teammeet.biometric_enabled.v1";

/** Default re-lock window — match plan default (5 min). */
export const BIOMETRIC_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export interface BiometricCapabilities {
  hasHardware: boolean;
  isEnrolled: boolean;
}

export async function getBiometricCapabilities(): Promise<BiometricCapabilities> {
  try {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return { hasHardware, isEnrolled };
  } catch {
    return { hasHardware: false, isEnrolled: false };
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  try {
    const value = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
    return value === "1";
  } catch {
    return false;
  }
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  try {
    if (enabled) {
      await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, "1");
    } else {
      await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
    }
  } catch {
    // Some local simulator builds cannot carry keychain entitlements.
    // Treat biometric opt-in as unavailable instead of breaking auth flows.
  }
}

export interface AuthResult {
  success: boolean;
  /** True if the OS reports the enrolled biometrics changed since opt-in. */
  reEnrolled?: boolean;
  /** Native error message if not successful. */
  error?: string;
}

export async function authenticate(reason: string): Promise<AuthResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      // Allow device passcode as a fallback so users who fail biometrics 3×
      // can still unlock without re-typing their TeamMeet password.
      disableDeviceFallback: false,
      cancelLabel: "Use password",
    });
    if (result.success) return { success: true };
    const errorCode = (result as { error?: string }).error ?? "unknown";
    return {
      success: false,
      reEnrolled: errorCode === "biometric_changed" || errorCode === "biometric_not_enrolled",
      error: errorCode,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
