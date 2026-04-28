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

import { unregisterPushToken } from "@/lib/notifications";
import { setBiometricEnabled } from "@/lib/biometric";
import * as sentry from "@/lib/analytics/sentry";

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

  try {
    await setBiometricEnabled(false);
  } catch (err) {
    sentry.captureException(err as Error, {
      context: "signOutCleanup.setBiometricEnabled",
    });
  }
}
