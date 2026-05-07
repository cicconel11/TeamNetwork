/**
 * Session-lifecycle cleanup.
 *
 * `signOutCleanup` runs BEFORE `supabase.auth.signOut()` so any RLS-gated
 * deletes (currently `user_push_tokens`) execute while the user is still
 * authenticated.
 *
 * Direct function — no registry abstraction. With ≤6 known callers shipping
 * across 4 phases by the same team, a registry pattern is YAGNI; a grep for
 * `signOutCleanup` should immediately reveal everything that runs at sign-out.
 *
 * P0a: only push token deregistration. Later phases extend in place:
 *   - R3 calendar — remove device calendars created for this user/device
 *   - R5 biometric — clear biometric flag + biometric-protected SecureStore items
 *   - R6 wallet — enqueue server-side wallet pass revocation push
 *   - R7 live activities — end any active LA + clear stored push tokens
 *   - R8 quick actions — clear dynamic shortcut items
 */

import { Platform } from "react-native";
import * as Application from "expo-application";
import { unregisterPushToken } from "@/lib/notifications";
import { setBiometricEnabled } from "@/lib/biometric";
import { clearLastActiveOrg, clearQuickActions } from "@/lib/quick-actions";
import { fetchWithAuth } from "@/lib/web-api";
import * as sentry from "@/lib/analytics/sentry";
import { LiveActivityNative } from "../../modules/live-activity/src";

export interface SignOutCleanupOptions {
  userId: string;
}

export async function signOutCleanup({ userId }: SignOutCleanupOptions): Promise<void> {
  void userId; // forward-compat with later branches that need it

  try {
    await unregisterPushToken();
  } catch (err) {
    sentry.captureException(err as Error, {
      context: "signOutCleanup.unregisterPushToken",
    });
  }

  // R7: end every active Live Activity on this device, then ask the server to
  // mark the corresponding `live_activity_tokens` rows as `ended_at = now()`
  // so the dispatcher stops fanning out to a logged-out token. The server
  // call has to happen BEFORE supabase.auth.signOut() so the session is still
  // valid; signOutCleanup is invoked from AuthContext exactly there.
  if (Platform.OS === "ios") {
    try {
      await LiveActivityNative.endAll("immediate");
    } catch (err) {
      sentry.captureException(err as Error, {
        context: "signOutCleanup.endAllLiveActivities",
      });
    }

    try {
      const deviceId =
        (await Application.getIosIdForVendorAsync()) ??
        Application.applicationId ??
        "unknown-device";
      await fetchWithAuth("/api/live-activity/unregister", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
    } catch (err) {
      sentry.captureException(err as Error, {
        context: "signOutCleanup.unregisterLiveActivities",
      });
    }
  }

  try {
    await setBiometricEnabled(false);
  } catch (err) {
    sentry.captureException(err as Error, {
      context: "signOutCleanup.setBiometricEnabled",
    });
  }

  try {
    await Promise.all([clearLastActiveOrg(), clearQuickActions()]);
  } catch (err) {
    sentry.captureException(err as Error, {
      context: "signOutCleanup.quickActions",
    });
  }
}
