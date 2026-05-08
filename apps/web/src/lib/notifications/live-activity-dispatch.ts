/**
 * Live Activity dispatcher — handles `notification_jobs.kind` rows of
 * `live_activity_start | live_activity_update | live_activity_end` by sending
 * APNs `liveactivity` pushes to every active token registered for the event.
 *
 * Job payload contract (`notification_jobs.data`):
 *   - `event_id` (uuid, required)
 *   - `activity_id` (text, optional — if set, target only that activity row)
 *   - `content_state` (jsonb, required for start/update; optional for end)
 *   - `alert` ({ title, body }, optional — surfaces a banner on the lock screen)
 *   - `dismissal_date` (epoch seconds, optional — `aps.dismissal-date` for end)
 *   - `stale_date` (epoch seconds, optional — `aps.stale-date`)
 *
 * Env: APNS_KEY_ID, APNS_TEAM_ID, APNS_AUTH_KEY (.p8 PEM, may be base64-
 * encoded), APNS_BUNDLE_ID (defaults to `com.myteamnetwork.teammeet`),
 * APNS_USE_SANDBOX (truthy → sandbox host).
 */

import { createApnsClient, ApnsError, type ApnsClient } from "@teammeet/core/apns";
import type { SupabaseClient } from "@supabase/supabase-js";

type LiveActivityKind =
  | "live_activity_start"
  | "live_activity_update"
  | "live_activity_end";

interface JobData {
  event_id?: string;
  activity_id?: string;
  content_state?: Record<string, unknown>;
  alert?: { title?: string; body?: string };
  dismissal_date?: number;
  stale_date?: number;
}

interface TokenRow {
  activity_id: string;
  push_token: string;
  user_id: string;
  event_id: string;
}

interface DispatchResult {
  sent: number;
  failed: number;
  errors: string[];
}

let cachedClient: ApnsClient | null = null;

function getApnsClient(): ApnsClient {
  if (cachedClient) return cachedClient;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const rawKey = process.env.APNS_AUTH_KEY;
  if (!keyId || !teamId || !rawKey) {
    throw new Error(
      "APNs not configured: APNS_KEY_ID, APNS_TEAM_ID, APNS_AUTH_KEY required",
    );
  }
  const privateKeyPem = rawKey.includes("BEGIN PRIVATE KEY")
    ? rawKey.replace(/\\n/g, "\n")
    : Buffer.from(rawKey, "base64").toString("utf8");
  cachedClient = createApnsClient({
    keyId,
    teamId,
    privateKeyPem,
    sandbox: process.env.APNS_USE_SANDBOX === "true",
  });
  return cachedClient;
}

function bundleId(): string {
  return process.env.APNS_BUNDLE_ID ?? "com.myteamnetwork.teammeet";
}

function apnsEvent(kind: LiveActivityKind): "start" | "update" | "end" {
  if (kind === "live_activity_start") return "start";
  if (kind === "live_activity_end") return "end";
  return "update";
}

export async function dispatchLiveActivityJob(args: {
  supabase: SupabaseClient;
  kind: LiveActivityKind;
  data: JobData;
}): Promise<DispatchResult> {
  const { supabase, kind, data } = args;
  const result: DispatchResult = { sent: 0, failed: 0, errors: [] };

  if (!data.event_id) {
    throw new Error("live_activity job missing data.event_id");
  }
  if (kind !== "live_activity_end" && !data.content_state) {
    throw new Error(`live_activity ${kind} requires data.content_state`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = supabase as any;
  let query = svc
    .from("live_activity_tokens")
    .select("activity_id, push_token, user_id, event_id")
    .eq("event_id", data.event_id)
    .is("ended_at", null);
  if (data.activity_id) {
    query = query.eq("activity_id", data.activity_id);
  }
  const { data: rows, error: tokensErr } = await query;
  if (tokensErr) throw new Error(`token lookup: ${tokensErr.message}`);

  const tokens = (rows ?? []) as TokenRow[];
  if (tokens.length === 0) return result;

  const client = getApnsClient();
  const topic = `${bundleId()}.push-type.liveactivity`;
  const event = apnsEvent(kind);
  const timestamp = Math.floor(Date.now() / 1000);

  // aps.event="end" must always carry a content-state (Apple requirement
  // even though the activity is ending), so synthesize an empty object if
  // the caller didn't pass one.
  const contentState = data.content_state ?? {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apsBody: Record<string, any> = {
    event,
    timestamp,
    "content-state": contentState,
  };
  if (data.alert?.title || data.alert?.body) {
    apsBody.alert = {
      title: data.alert.title ?? "",
      body: data.alert.body ?? "",
    };
  }
  if (event === "end" && typeof data.dismissal_date === "number") {
    apsBody["dismissal-date"] = data.dismissal_date;
  }
  if (typeof data.stale_date === "number") {
    apsBody["stale-date"] = data.stale_date;
  }

  const payload = { aps: apsBody };

  await Promise.all(
    tokens.map(async (token) => {
      try {
        await client.send({
          token: token.push_token,
          topic,
          pushType: "liveactivity",
          payload,
          priority: 10,
          // 24h expiry — never let an LA push outlive the activity itself.
          expiration: timestamp + 24 * 3600,
        });
        result.sent += 1;
      } catch (err) {
        result.failed += 1;
        const msg =
          err instanceof ApnsError
            ? `${err.status} ${err.responseBody || err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        result.errors.push(`${token.activity_id}: ${msg}`);

        // Apple says 410 = "device token is no longer valid" — mark ended
        // so we stop trying.
        if (err instanceof ApnsError && err.status === 410) {
          await svc
            .from("live_activity_tokens")
            .update({ ended_at: new Date().toISOString() })
            .eq("activity_id", token.activity_id);
        }
      }
    }),
  );

  // For a successful `end`, mark the rows ended so future fan-outs skip them.
  if (event === "end" && result.failed === 0) {
    const ids = tokens.map((t) => t.activity_id);
    await svc
      .from("live_activity_tokens")
      .update({ ended_at: new Date().toISOString() })
      .in("activity_id", ids);
  }

  return result;
}

export function isLiveActivityKind(kind: string): kind is LiveActivityKind {
  return (
    kind === "live_activity_start" ||
    kind === "live_activity_update" ||
    kind === "live_activity_end"
  );
}
