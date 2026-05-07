/**
 * BiometricLockContext (R5).
 *
 * Locks the app on cold start and on foreground-after-timeout when the user
 * has opted in. Renders a `<LockScreen />` overlay that prompts for biometric
 * (or device passcode fallback) and clears the lock on success.
 *
 * Scope decisions for v1:
 * - Timeout is a constant (BIOMETRIC_LOCK_TIMEOUT_MS = 5 min). User-configurable
 *   timeout deferred until we add a `user_app_preferences` row.
 * - On re-enrollment failure (OS reports `biometric_changed`), we clear the
 *   opt-in flag so the user has to re-opt-in next session — matches plan R5.4.
 * - No privacy-overlay screenshot blur for v1; iOS/Android default screenshot
 *   behaviour is acceptable.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState, type AppStateStatus, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import {
  authenticate,
  BIOMETRIC_LOCK_TIMEOUT_MS,
  isBiometricEnabled,
  setBiometricEnabled,
} from "@/lib/biometric";
import { LockScreen } from "@/components/biometric/LockScreen";

interface BiometricLockState {
  /** True while the lock overlay should cover the app. */
  isLocked: boolean;
  /** True while initial enabled-flag lookup is pending — render nothing visible. */
  isResolving: boolean;
  /** Trigger a lock immediately (used after enabling from settings). */
  lock: () => void;
  /** Attempt to unlock — surfaces a system biometric prompt. */
  unlock: () => Promise<{ success: boolean }>;
}

const BiometricLockContext = createContext<BiometricLockState | null>(null);

export function useBiometricLock(): BiometricLockState {
  const ctx = useContext(BiometricLockContext);
  if (!ctx) {
    throw new Error("useBiometricLock must be used within BiometricLockProvider");
  }
  return ctx;
}

export function BiometricLockProvider({ children }: PropsWithChildren) {
  const [enabled, setEnabled] = useState(false);
  const [isResolving, setIsResolving] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const lastBackgroundedAtRef = useRef<number | null>(null);
  // Read inside the AppState handler so the listener can stay stable across
  // enable/disable toggles. Avoids a race where re-subscribing drops the
  // backgrounded timestamp mid-toggle.
  const enabledRef = useRef(false);

  // Cold-start: read enabled flag and lock if needed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const on = await isBiometricEnabled();
      if (cancelled) return;
      enabledRef.current = on;
      setEnabled(on);
      if (on) setIsLocked(true);
      setIsResolving(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // AppState: lock when foregrounding after timeout, and track current state
  // so we can render a privacy overlay during inactive/background (the
  // moments iOS captures the app-switcher snapshot). Subscribed once with no
  // deps; reads `enabled` via a ref to stay stable across toggles.
  useEffect(() => {
    const handler = (next: AppStateStatus) => {
      setAppState(next);
      if (!enabledRef.current) return;
      if (next === "background" || next === "inactive") {
        lastBackgroundedAtRef.current = Date.now();
        return;
      }
      if (next === "active") {
        const since = lastBackgroundedAtRef.current;
        if (since != null && Date.now() - since >= BIOMETRIC_LOCK_TIMEOUT_MS) {
          setIsLocked(true);
        }
        lastBackgroundedAtRef.current = null;
      }
    };
    const sub = AppState.addEventListener("change", handler);
    return () => sub.remove();
  }, []);

  const showPrivacyOverlay = enabled && appState !== "active";

  const lock = useCallback(() => setIsLocked(true), []);

  const unlock = useCallback(async (): Promise<{ success: boolean }> => {
    const result = await authenticate("Unlock TeamMeet");
    if (result.success) {
      setIsLocked(false);
      return { success: true };
    }
    if (result.reEnrolled) {
      // Re-enrollment invalidates the credential — force re-opt-in.
      await setBiometricEnabled(false);
      enabledRef.current = false;
      setEnabled(false);
      setIsLocked(false);
    }
    return { success: false };
  }, []);

  return (
    <BiometricLockContext.Provider value={{ isLocked, isResolving, lock, unlock }}>
      {/* While we don't yet know the enabled flag, render nothing — avoids a
          flash of unlocked content when biometric IS enabled. */}
      {isResolving ? <View style={{ flex: 1, backgroundColor: "#0f172a" }} /> : children}
      {showPrivacyOverlay && !isLocked && <PrivacyOverlay />}
      {isLocked && !isResolving && <LockScreen onUnlock={unlock} />}
    </BiometricLockContext.Provider>
  );
}

/**
 * Opaque overlay shown while the app is inactive/backgrounded so the iOS
 * app-switcher snapshot doesn't leak personal content. Only renders when
 * biometric is enabled — users who haven't opted in keep the default snapshot
 * behavior.
 */
function PrivacyOverlay() {
  return (
    <View style={privacyStyles.overlay} pointerEvents="none">
      <Image
        source={require("../../assets/brand-logo.png")}
        style={privacyStyles.logo}
        contentFit="contain"
        transition={0}
        cachePolicy="memory"
      />
    </View>
  );
}

const privacyStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9998,
    elevation: 9998,
  },
  logo: { width: 200, height: 60 },
});
