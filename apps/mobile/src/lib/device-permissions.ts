/**
 * Unified device-permission hook.
 *
 * One hook for the four runtime permissions the app needs across phases:
 * notifications (P0a/R1), camera (P1/R2b), calendar (P2/R3), biometric (P1/R5).
 *
 * Note the filename: `device-permissions.ts` (not `permissions.ts`) — there is
 * already a `permissions.ts` in this directory that re-exports role-based
 * feature-permission helpers from `@teammeet/core`. Different concept; do not
 * conflate.
 *
 * P0a ships the `notifications` kind (which is already wired via the existing
 * `requestNotificationPermissions()` helper). Other kinds return a stable
 * shape with `status: 'unsupported'` until their phase lands and their native
 * module is added to `package.json`.
 *
 * Pre-prompt UI is inlined at each call site — no shared `<PermissionPrePrompt>`
 * component. Per-permission copy diverges enough that the abstraction is YAGNI.
 */

import { useCallback, useEffect, useState } from "react";
import { Linking, Platform } from "react-native";
import { requestNotificationPermissions } from "@/lib/notifications";

export type PermissionKind = "notifications" | "camera" | "calendar" | "biometric";

export type PermissionStatus =
  | "granted"
  | "denied"
  | "undetermined"
  | "unsupported"
  | "loading";

export interface DevicePermissionState {
  status: PermissionStatus;
  /** Whether the OS will let us prompt again. False on iOS after first hard deny. */
  canAskAgain: boolean;
  /** Trigger the system permission prompt. Returns the resulting status. */
  request: () => Promise<PermissionStatus>;
  /** Open the iOS / Android system Settings app for this app. */
  openSettings: () => Promise<void>;
  /** Suggested copy for the in-app pre-prompt sheet. Inline at call site. */
  copy: PermissionCopy;
}

export interface PermissionCopy {
  title: string;
  body: string;
  primaryCta: string;
  /** Optional copy shown when the OS is in a hard-deny state. */
  deniedHint?: string;
}

const COPY: Record<PermissionKind, PermissionCopy> = {
  notifications: {
    title: "Stay in the loop",
    body: "TeamMeet sends pushes for new announcements, chat mentions, and event reminders. You can pick which categories in Settings later.",
    primaryCta: "Turn on notifications",
    deniedHint: "Open Settings to enable notifications for TeamMeet.",
  },
  camera: {
    title: "Scan to join or check in",
    body: "Use the camera to scan a TeamMeet QR code — to join your organization or to check members in at events.",
    primaryCta: "Allow camera",
    deniedHint: "Camera access is off. Open Settings to enable it.",
  },
  calendar: {
    title: "Add events to your calendar",
    body: "TeamMeet writes practices, games, and events into your device calendar so you see them alongside your other commitments.",
    primaryCta: "Allow calendar",
    deniedHint: "Calendar access is off. Open Settings to enable it.",
  },
  biometric: {
    title: "Faster sign-in",
    body: "Use Face ID or Touch ID to unlock TeamMeet without typing your password each time.",
    primaryCta: "Enable biometrics",
    deniedHint: "Set up Face ID, Touch ID, or a fingerprint in your device settings to use this.",
  },
};

/**
 * Get and manage a single device permission.
 *
 * P0a: only `notifications` is fully wired. The other kinds return
 * `status: 'unsupported'` and a `request` that resolves to `'unsupported'`
 * until R2b (camera), R3 (calendar), and R5 (biometric) ship the underlying
 * Expo modules and replace the stubs.
 */
export function useDevicePermission(kind: PermissionKind): DevicePermissionState {
  const [status, setStatus] = useState<PermissionStatus>("loading");
  const [canAskAgain, setCanAskAgain] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    if (Platform.OS === "web") {
      setStatus("unsupported");
      setCanAskAgain(false);
      return;
    }
    if (kind === "notifications") {
      const Notifications = await import("expo-notifications");
      const { status: current, canAskAgain: ask } = await Notifications.getPermissionsAsync();
      setStatus(mapNativeStatus(current));
      setCanAskAgain(ask);
      return;
    }
    if (kind === "camera") {
      const { Camera } = await import("expo-camera");
      const { status: current, canAskAgain: ask } = await Camera.getCameraPermissionsAsync();
      setStatus(mapNativeStatus(current));
      setCanAskAgain(ask);
      return;
    }
    if (kind === "calendar") {
      const Calendar = await import("expo-calendar");
      const { status: current, canAskAgain: ask } =
        await Calendar.getCalendarPermissionsAsync();
      setStatus(mapNativeStatus(current));
      setCanAskAgain(ask);
      return;
    }
    if (kind === "biometric") {
      const { getBiometricCapabilities } = await import("@/lib/biometric");
      const { hasHardware, isEnrolled } = await getBiometricCapabilities();
      if (!hasHardware) {
        setStatus("unsupported");
        setCanAskAgain(false);
        return;
      }
      setStatus(isEnrolled ? "granted" : "undetermined");
      setCanAskAgain(true);
      return;
    }
    setStatus("unsupported");
    setCanAskAgain(false);
  }, [kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const request = useCallback(async (): Promise<PermissionStatus> => {
    if (kind === "notifications") {
      const granted = await requestNotificationPermissions();
      const next: PermissionStatus = granted ? "granted" : "denied";
      setStatus(next);
      if (!granted) setCanAskAgain(false);
      return next;
    }
    if (kind === "camera") {
      const { Camera } = await import("expo-camera");
      const { status: current, canAskAgain: ask } =
        await Camera.requestCameraPermissionsAsync();
      const next = mapNativeStatus(current);
      setStatus(next);
      setCanAskAgain(ask);
      return next;
    }
    if (kind === "calendar") {
      const Calendar = await import("expo-calendar");
      const { status: current, canAskAgain: ask } =
        await Calendar.requestCalendarPermissionsAsync();
      const next = mapNativeStatus(current);
      setStatus(next);
      setCanAskAgain(ask);
      return next;
    }
    return "unsupported";
  }, [kind]);

  const openSettings = useCallback(async () => {
    await Linking.openSettings();
  }, []);

  return {
    status,
    canAskAgain,
    request,
    openSettings,
    copy: COPY[kind],
  };
}

function mapNativeStatus(value: string): PermissionStatus {
  if (value === "granted") return "granted";
  if (value === "denied") return "denied";
  return "undetermined";
}
