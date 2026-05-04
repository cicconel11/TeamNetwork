/**
 * Server-side Expo Push fan-out.
 *
 * P0a scope: minimal, inline send for v1. Two-tier dispatch:
 *   - 1 recipient (chat DM, single mention) → inline await from API route
 *   - Broadcasts → still inline for now; can be migrated to a worker that
 *     drains `notification_jobs` once an org breaches the Vercel timeout.
 *
 * Token resolution today is a 3-step query (members → preferences → tokens)
 * because the recipient-resolution RPC recommended in the deepened plan is a
 * P1 follow-up. The shape of `sendPush` does not depend on the resolver, so
 * swapping in `resolve_push_targets()` later is a one-line change.
 *
 * DeviceNotRegistered tickets are handled inline — that token row is deleted
 * immediately. Other receipt errors are logged but not retried here; a later
 * `cron/push-receipts` run will handle async receipt polling.
 */

import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  NotificationAudience,
  UserRole,
} from "@/types/database";
import type { NotificationCategory } from "@/lib/notifications";

export type PushType =
  | "announcement"
  | "event"
  | "event_reminder"
  | "chat"
  | "discussion"
  | "mentorship"
  | "donation"
  | "membership"
  | "notification";

export interface SendPushInput {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  audience?: NotificationAudience | null;
  /** Explicit user list. If both `audience` and `targetUserIds` are set, intersection wins. */
  targetUserIds?: string[] | null;
  title: string;
  body: string;
  /** Per-category gating against `notification_preferences.<category>_push_enabled`. */
  category?: NotificationCategory;
  pushType?: PushType;
  pushResourceId?: string;
  /** Optional Expo `data` payload — drives `getNotificationRoute` on the device. */
  data?: Record<string, unknown>;
  /** Optional org slug — included in `data` so the device can route on tap. */
  orgSlug?: string;
}

export interface SendPushResult {
  /** Number of pushes Expo accepted (ticket.status === 'ok'). */
  sent: number;
  /** Recipients skipped because they had no token, push disabled, or category opted out. */
  skipped: number;
  /** Receipt-error messages for diagnostic surfaces. */
  errors: string[];
}

/**
 * Map a NotificationCategory to the boolean column on notification_preferences
 * that controls push for that category. Mirrors the email map in lib/notifications.ts.
 */
const CATEGORY_PUSH_COLUMN: Record<NotificationCategory, string> = {
  announcement: "announcement_push_enabled",
  chat: "chat_push_enabled",
  discussion: "discussion_push_enabled",
  event: "event_push_enabled",
  event_reminder: "event_reminder_push_enabled",
  workout: "workout_push_enabled",
  competition: "competition_push_enabled",
  mentorship: "mentorship_push_enabled",
};

const expoClient = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN,
  useFcmV1: true,
});

interface MembershipRow {
  user_id: string;
  role: string;
}

interface PreferenceRow {
  user_id: string | null;
  push_enabled: boolean | null;
  [column: string]: unknown;
}

interface TokenRow {
  user_id: string;
  expo_push_token: string;
}

/**
 * Resolve which (user_id, expo_push_token) pairs should receive a push,
 * applying audience filtering and per-category preference gating.
 *
 * Three-step query is intentional for v1; replace with `resolve_push_targets()`
 * RPC once it lands.
 */
async function resolvePushTargets(
  input: SendPushInput
): Promise<{ tokens: string[]; resolvedUsers: number; skippedUsers: number }> {
  const { supabase, organizationId, audience, targetUserIds, category } = input;

  const audienceRoles: readonly UserRole[] = mapAudienceToRoles(audience ?? "both");

  // Step 1: memberships in the org for the requested audience.
  let membershipQuery = supabase
    .from("user_organization_roles")
    .select("user_id, role")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("role", audienceRoles as readonly UserRole[]);

  if (targetUserIds && targetUserIds.length > 0) {
    membershipQuery = membershipQuery.in("user_id", targetUserIds);
  }

  const { data: memberships } = await membershipQuery;
  const userIds = (memberships as MembershipRow[] | null)?.map((m) => m.user_id) ?? [];

  if (userIds.length === 0) {
    return { tokens: [], resolvedUsers: 0, skippedUsers: 0 };
  }

  // Step 2: preferences for those users in this org.
  const prefColumns = ["user_id", "push_enabled"];
  if (category && CATEGORY_PUSH_COLUMN[category]) {
    prefColumns.push(CATEGORY_PUSH_COLUMN[category]);
  }

  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select(prefColumns.join(","))
    .eq("organization_id", organizationId)
    .in("user_id", userIds);

  const prefByUser = new Map<string, PreferenceRow>();
  (prefs as PreferenceRow[] | null)?.forEach((row) => {
    if (row.user_id) prefByUser.set(row.user_id, row);
  });

  const allowedUserIds = userIds.filter((userId) => {
    const pref = prefByUser.get(userId);
    if (!pref) {
      // No row yet → defaults apply. New columns default to true for
      // announcement/chat/event_reminder, false for the rest.
      return defaultPushEnabled(category);
    }
    if (pref.push_enabled === false) return false;
    if (category) {
      const col = CATEGORY_PUSH_COLUMN[category];
      if (col && pref[col] === false) return false;
    }
    return true;
  });

  if (allowedUserIds.length === 0) {
    return { tokens: [], resolvedUsers: userIds.length, skippedUsers: userIds.length };
  }

  // Step 3: tokens for the surviving users (multi-device → multiple rows).
  // Cast: `user_push_tokens` is in the database (migration 20260425100000)
  // but not yet in the generated `Database` types. Regenerate via
  // `bun run gen:types` to remove this cast.
  const { data: tokens } = await (supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        in: (col: string, vals: string[]) => Promise<{ data: TokenRow[] | null }>;
      };
    };
  })
    .from("user_push_tokens")
    .select("user_id, expo_push_token")
    .in("user_id", allowedUserIds);

  const tokenList =
    (tokens as TokenRow[] | null)
      ?.map((t) => t.expo_push_token)
      .filter((t) => Expo.isExpoPushToken(t)) ?? [];

  return {
    tokens: tokenList,
    resolvedUsers: allowedUserIds.length,
    skippedUsers: userIds.length - allowedUserIds.length,
  };
}

function mapAudienceToRoles(audience: NotificationAudience): readonly UserRole[] {
  if (audience === "members") return ["admin", "active_member", "member"];
  if (audience === "alumni") return ["alumni", "viewer"];
  return ["admin", "active_member", "member", "alumni", "viewer"];
}

function defaultPushEnabled(category?: NotificationCategory): boolean {
  // Mirrors the migration defaults for `*_push_enabled`.
  switch (category) {
    case "announcement":
    case "chat":
    case "event_reminder":
      return true;
    case "event":
    case "workout":
    case "competition":
    case "discussion":
    case "mentorship":
      return false;
    default:
      // Untyped pushes (e.g., donation) — default true so first-run users
      // still see notifications.
      return true;
  }
}

/**
 * Soft cap on the inline-dispatch path. Larger broadcasts must wait for the
 * `notification_jobs` worker to drain — which is not yet implemented (P1
 * follow-up). For now we send the first `INLINE_PUSH_TOKEN_CAP` tokens and
 * return the rest as `skipped` with an error string so callers can surface a
 * useful message instead of silently dropping recipients past the timeout.
 *
 * Why a hard cap: Vercel API routes have a 10s/15s/300s timeout depending on
 * plan and Expo's HTTP/2 push API rate-limits at ~600 req/sec; an 5000-alumni
 * announcement run inline trips both before completing.
 */
export const INLINE_PUSH_TOKEN_CAP = 200;

/**
 * Send Expo push notifications to all eligible recipients.
 *
 * Resolves recipients server-side, batches into ≤100/req chunks, and processes
 * tickets inline for synchronous error handling (DeviceNotRegistered → drop
 * the token row).
 */
export async function sendPush(input: SendPushInput): Promise<SendPushResult> {
  const { tokens: allTokens, resolvedUsers, skippedUsers } = await resolvePushTargets(input);

  if (allTokens.length === 0) {
    return { sent: 0, skipped: resolvedUsers + skippedUsers, errors: [] };
  }

  // Broadcasts above the inline cap are enqueued onto notification_jobs so
  // the cron worker fans them out without tripping the API timeout. Smaller
  // sends still go inline so chat DMs and reminders stay synchronous.
  if (allTokens.length > INLINE_PUSH_TOKEN_CAP) {
    const audienceForQueue =
      input.audience && input.audience !== "both" ? input.audience : "all";
    try {
      const { error: enqueueError } = await (input.supabase as unknown as {
        from: (table: string) => {
          insert: (
            row: Record<string, unknown>,
          ) => Promise<{ error: { message: string } | null }>;
        };
      })
        .from("notification_jobs")
        .insert({
          organization_id: input.organizationId,
          kind: "standard",
          priority: 5,
          audience: audienceForQueue,
          target_user_ids: input.targetUserIds ?? null,
          category: input.category ?? null,
          push_type: input.pushType ?? null,
          push_resource_id: input.pushResourceId ?? null,
          title: input.title,
          body: input.body,
          data: {
            ...(input.data ?? {}),
            ...(input.orgSlug ? { orgSlug: input.orgSlug } : {}),
          },
        });
      if (enqueueError) throw new Error(enqueueError.message);
      console.log(
        `[push] queued broadcast: ${allTokens.length} recipients org=${input.organizationId} type=${input.pushType ?? "unknown"}`,
      );
      return {
        sent: 0,
        skipped: skippedUsers,
        errors: [`queued: ${allTokens.length} recipients pending dispatch`],
      };
    } catch (err) {
      // Fall back to capped inline send so a queue failure doesn't lose
      // notifications entirely. Surface the overflow as before.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[push] enqueue failed, falling back to inline cap: ${msg}`,
      );
    }
  }

  // Inline path. If we got here with allTokens > cap, the queue insert
  // failed above — preserve the historical capped-send behavior so we still
  // deliver to as many recipients as possible.
  const overflow = Math.max(0, allTokens.length - INLINE_PUSH_TOKEN_CAP);
  const tokens = overflow > 0 ? allTokens.slice(0, INLINE_PUSH_TOKEN_CAP) : allTokens;
  const capErrors =
    overflow > 0
      ? [
          `inline push cap exceeded: skipped ${overflow} of ${allTokens.length} recipients (cap=${INLINE_PUSH_TOKEN_CAP}); queue insert failed`,
        ]
      : [];
  if (overflow > 0) {
    console.warn(
      `[push] ${capErrors[0]} (type=${input.pushType ?? "unknown"} org=${input.organizationId})`
    );
  }

  // Mobile's getNotificationRoute requires orgSlug + type + id to deep-link
  // on tap. Don't overwrite values from input.data with undefined — only set
  // each key when the corresponding input field is present.
  const data: Record<string, unknown> = {
    ...(input.data ?? {}),
    title: input.title,
    body: input.body,
  };
  if (input.pushType) data.type = input.pushType;
  if (input.pushResourceId) data.id = input.pushResourceId;
  if (input.orgSlug) data.orgSlug = input.orgSlug;

  if (input.pushType && !data.orgSlug) {
    console.warn(
      `[push] sending typed push without orgSlug (type=${input.pushType} org=${input.organizationId}); mobile taps will no-op`,
    );
  }

  const messages: ExpoPushMessage[] = tokens.map((token) => ({
    to: token,
    title: input.title,
    body: input.body,
    data,
    sound: "default",
  }));

  const chunks = expoClient.chunkPushNotifications(messages);
  const tickets: Array<{ token: string; ticket: ExpoPushTicket }> = [];
  const errors: string[] = [...capErrors];

  for (const chunk of chunks) {
    try {
      const chunkTickets = await expoClient.sendPushNotificationsAsync(chunk);
      chunkTickets.forEach((ticket, i) => {
        tickets.push({ token: chunk[i].to as string, ticket });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Chunk send failed: ${msg}`);
    }
  }

  let sent = 0;
  const tokensToDrop: string[] = [];

  for (const { token, ticket } of tickets) {
    if (ticket.status === "ok") {
      sent += 1;
      continue;
    }
    const errorCode = ticket.details?.error;
    if (errorCode === "DeviceNotRegistered") {
      tokensToDrop.push(token);
    } else {
      errors.push(`${errorCode ?? "unknown"}: ${ticket.message}`);
    }
  }

  if (tokensToDrop.length > 0) {
    // Best-effort cleanup; failure here does not affect send result.
    // Same `user_push_tokens` cast as above.
    await (input.supabase as unknown as {
      from: (table: string) => {
        delete: () => {
          in: (col: string, vals: string[]) => Promise<unknown>;
        };
      };
    })
      .from("user_push_tokens")
      .delete()
      .in("expo_push_token", tokensToDrop);
  }

  return { sent, skipped: skippedUsers + overflow, errors };
}
