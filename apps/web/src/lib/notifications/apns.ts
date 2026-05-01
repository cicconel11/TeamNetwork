/**
 * Server-side APNs client singleton + topic helpers.
 *
 * Reads the APNs `.p8` auth key from `APNS_AUTH_KEY` (base64-encoded full PEM).
 * We decode it once per cold start and memoize the `ApnsClient` so the JWT
 * stays cached across requests.
 *
 * If any of the env vars are missing, `getApnsClient()` returns `null` so
 * callers can fall back to a clear "APNs not configured" error rather than
 * panicking at import time.
 */

import { ApnsClient } from "@teammeet/core/apns";

let cachedClient: ApnsClient | null | undefined;

export function getApnsClient(): ApnsClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const authKeyB64 = process.env.APNS_AUTH_KEY;
  const sandbox = process.env.APNS_USE_SANDBOX === "true";

  if (!keyId || !teamId || !authKeyB64) {
    cachedClient = null;
    return null;
  }

  let pem: string;
  try {
    pem = Buffer.from(authKeyB64, "base64").toString("utf8");
  } catch (err) {
    console.error("[apns] failed to decode APNS_AUTH_KEY:", err);
    cachedClient = null;
    return null;
  }
  if (!pem.includes("BEGIN PRIVATE KEY")) {
    console.error("[apns] APNS_AUTH_KEY does not look like a PEM private key");
    cachedClient = null;
    return null;
  }

  cachedClient = new ApnsClient({
    keyId,
    teamId,
    privateKeyPem: pem,
    sandbox,
  });
  return cachedClient;
}

/**
 * Resolve the APNs `apns-topic` for a given `notification_jobs.kind`.
 *
 * For Live Activities the topic is `${BUNDLE_ID}.push-type.liveactivity`.
 * For wallet pushes it's the pass type id (handled separately).
 * Standard alerts go through Expo and never reach this branch.
 */
export function getApnsTopicForKind(kind: string): string | null {
  const bundleId = process.env.APNS_BUNDLE_ID || "com.myteamnetwork.teammeet";

  if (kind.startsWith("live_activity_")) {
    return `${bundleId}.push-type.liveactivity`;
  }
  if (kind === "wallet_update") {
    return process.env.APNS_WALLET_PASS_TYPE_ID ?? null;
  }
  return null;
}
