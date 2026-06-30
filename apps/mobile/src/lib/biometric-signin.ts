import type { Session } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  authenticate,
  getBiometricCapabilities,
  isBiometricEnabled,
  setBiometricEnabled,
} from "@/lib/biometric";
import { supabase } from "@/lib/supabase";

const BIOMETRIC_SESSION_KEY = "teammeet.biometric_session.v1";
const BIOMETRIC_SESSION_MARKER_KEY = "teammeet.biometric_session_available.v1";

const BIOMETRIC_SESSION_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "com.myteamnetwork.teammeet.biometric-signin",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: true,
  authenticationPrompt: "Sign in to TeamNetwork",
};

const BIOMETRIC_MARKER_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "com.myteamnetwork.teammeet.biometric-signin-meta",
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

interface StoredBiometricSession {
  access_token: string;
  refresh_token: string;
  user_id: string;
  saved_at: string;
  expires_at?: number;
}

export type BiometricSignInResult =
  | { success: true }
  | { success: false; error: string; expired?: boolean; cancelled?: boolean };

function canUseProtectedSecureStore(): boolean {
  if (Platform.OS === "web") return false;
  if (typeof SecureStore.canUseBiometricAuthentication !== "function") return true;
  return SecureStore.canUseBiometricAuthentication();
}

function toStoredSession(session: Session): StoredBiometricSession | null {
  if (!session.access_token || !session.refresh_token || !session.user?.id) {
    return null;
  }

  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    user_id: session.user.id,
    saved_at: new Date().toISOString(),
    expires_at: session.expires_at,
  };
}

function parseStoredSession(raw: string): StoredBiometricSession | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredBiometricSession>;
    if (
      typeof parsed.access_token !== "string" ||
      typeof parsed.refresh_token !== "string" ||
      typeof parsed.user_id !== "string"
    ) {
      return null;
    }
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      user_id: parsed.user_id,
      saved_at: typeof parsed.saved_at === "string" ? parsed.saved_at : new Date(0).toISOString(),
      expires_at: typeof parsed.expires_at === "number" ? parsed.expires_at : undefined,
    };
  } catch {
    return null;
  }
}

async function hasBiometricSessionMarker(): Promise<boolean> {
  try {
    return (
      (await SecureStore.getItemAsync(BIOMETRIC_SESSION_MARKER_KEY, BIOMETRIC_MARKER_OPTIONS)) ===
      "1"
    );
  } catch {
    return false;
  }
}

export async function canShowBiometricSignIn(): Promise<boolean> {
  const [enabled, marker, capabilities] = await Promise.all([
    isBiometricEnabled(),
    hasBiometricSessionMarker(),
    getBiometricCapabilities(),
  ]);

  return (
    enabled &&
    marker &&
    capabilities.hasHardware &&
    capabilities.isEnrolled &&
    canUseProtectedSecureStore()
  );
}

async function saveBiometricSession(session: Session): Promise<boolean> {
  const stored = toStoredSession(session);
  if (!stored || !canUseProtectedSecureStore()) {
    return false;
  }

  await SecureStore.setItemAsync(
    BIOMETRIC_SESSION_KEY,
    JSON.stringify(stored),
    BIOMETRIC_SESSION_OPTIONS
  );
  await SecureStore.setItemAsync(BIOMETRIC_SESSION_MARKER_KEY, "1", BIOMETRIC_MARKER_OPTIONS);
  return true;
}

export async function enableBiometricSignIn(
  session: Session | null
): Promise<BiometricSignInResult> {
  if (!session) {
    return { success: false, error: "Sign in before enabling biometric sign-in." };
  }

  const capabilities = await getBiometricCapabilities();
  if (!capabilities.hasHardware || !capabilities.isEnrolled || !canUseProtectedSecureStore()) {
    return { success: false, error: "Biometric sign-in is not available on this device." };
  }

  const authResult = await authenticate("Enable Face ID for TeamNetwork");
  if (!authResult.success) {
    return {
      success: false,
      error: authResult.error ?? "Biometric authentication was cancelled.",
      cancelled: authResult.error === "user_cancel" || authResult.error === "system_cancel",
    };
  }

  try {
    const saved = await saveBiometricSession(session);
    if (!saved) {
      return { success: false, error: "Could not save biometric sign-in on this device." };
    }
    await setBiometricEnabled(true);
    return { success: true };
  } catch (error) {
    await clearBiometricSignIn();
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not enable biometric sign-in.",
    };
  }
}

export async function clearBiometricSignIn(): Promise<void> {
  await Promise.allSettled([
    SecureStore.deleteItemAsync(BIOMETRIC_SESSION_KEY, BIOMETRIC_SESSION_OPTIONS),
    SecureStore.deleteItemAsync(BIOMETRIC_SESSION_MARKER_KEY, BIOMETRIC_MARKER_OPTIONS),
    setBiometricEnabled(false),
  ]);
}

export async function signInWithBiometrics(): Promise<BiometricSignInResult> {
  if (!(await canShowBiometricSignIn())) {
    return { success: false, error: "Biometric sign-in is not available on this device." };
  }

  let stored: StoredBiometricSession | null = null;
  try {
    const raw = await SecureStore.getItemAsync(BIOMETRIC_SESSION_KEY, BIOMETRIC_SESSION_OPTIONS);
    if (!raw) {
      await clearBiometricSignIn();
      return {
        success: false,
        error: "Biometric sign-in expired. Sign in with your password.",
        expired: true,
      };
    }
    stored = parseStoredSession(raw);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Biometric authentication was cancelled.",
      cancelled: true,
    };
  }

  if (!stored) {
    await clearBiometricSignIn();
    return {
      success: false,
      error: "Biometric sign-in expired. Sign in with your password.",
      expired: true,
    };
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
  });

  if (error) {
    await clearBiometricSignIn();
    return {
      success: false,
      error: "Biometric sign-in expired. Sign in with your password.",
      expired: true,
    };
  }

  if (data.session) {
    // Refresh tokens can rotate during setSession. Update only inside this
    // user-initiated biometric flow so the OS never prompts from the background.
    await saveBiometricSession(data.session).catch(() => undefined);
  }

  return { success: true };
}
