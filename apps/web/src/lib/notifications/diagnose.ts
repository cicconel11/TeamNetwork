/**
 * Push delivery diagnostic. Given an org + audience + category, walk every
 * prospective recipient and report exactly which gate would drop them, so
 * "members aren't getting pushes when they have it on" can be answered with a
 * specific user list rather than a guess.
 *
 * Mirrors the resolver in `push.ts` but does NOT short-circuit — every user is
 * evaluated against every gate so the table is complete.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  NotificationAudience,
  UserRole,
} from "@/types/database";
import type { NotificationCategory } from "@/lib/notifications";
import { Expo } from "expo-server-sdk";

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

function defaultPushEnabled(category?: NotificationCategory): boolean {
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
      return true;
  }
}

function mapAudienceToRoles(audience: NotificationAudience): readonly UserRole[] {
  if (audience === "members") return ["admin", "active_member", "member"];
  if (audience === "alumni") return ["alumni", "viewer"];
  return ["admin", "active_member", "member", "alumni", "viewer"];
}

export type DropReason =
  | "delivered"
  | "no_token"
  | "global_push_disabled"
  | "category_disabled"
  | "invalid_token";

export interface RecipientReport {
  userId: string;
  role: string;
  pushEnabled: boolean | "default";
  categoryEnabled: boolean | "default";
  tokenCount: number;
  validTokenCount: number;
  reason: DropReason;
}

export interface DiagnoseResult {
  audienceRoles: readonly UserRole[];
  totalInAudience: number;
  delivered: number;
  byReason: Record<DropReason, number>;
  recipients: RecipientReport[];
}

export interface DiagnoseInput {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  audience?: NotificationAudience | null;
  category?: NotificationCategory;
}

export async function diagnosePush(input: DiagnoseInput): Promise<DiagnoseResult> {
  const { supabase, organizationId, audience, category } = input;
  const audienceRoles = mapAudienceToRoles(audience ?? "both");

  const { data: memberships, error: mErr } = await supabase
    .from("user_organization_roles")
    .select("user_id, role")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("role", audienceRoles as readonly UserRole[]);

  if (mErr) throw new Error(`membership query failed: ${mErr.message}`);

  const members = (memberships ?? []) as Array<{ user_id: string; role: string }>;
  const userIds = members.map((m) => m.user_id);

  const prefColumns = ["user_id", "push_enabled"];
  if (category && CATEGORY_PUSH_COLUMN[category]) {
    prefColumns.push(CATEGORY_PUSH_COLUMN[category]);
  }

  const prefByUser = new Map<string, Record<string, unknown>>();
  if (userIds.length > 0) {
    const { data: prefs, error: pErr } = await supabase
      .from("notification_preferences")
      .select(prefColumns.join(","))
      .eq("organization_id", organizationId)
      .in("user_id", userIds);
    if (pErr) throw new Error(`preferences query failed: ${pErr.message}`);
    for (const row of (prefs ?? []) as unknown as Array<Record<string, unknown>>) {
      const uid = row.user_id as string | null;
      if (uid) prefByUser.set(uid, row);
    }
  }

  const tokensByUser = new Map<string, string[]>();
  if (userIds.length > 0) {
    const { data: tokens, error: tErr } = await (supabase as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          in: (
            col: string,
            vals: string[],
          ) => Promise<{
            data: Array<{ user_id: string; expo_push_token: string }> | null;
            error: { message: string } | null;
          }>;
        };
      };
    })
      .from("user_push_tokens")
      .select("user_id, expo_push_token")
      .in("user_id", userIds);
    if (tErr) throw new Error(`tokens query failed: ${tErr.message}`);
    for (const row of tokens ?? []) {
      const list = tokensByUser.get(row.user_id) ?? [];
      list.push(row.expo_push_token);
      tokensByUser.set(row.user_id, list);
    }
  }

  const recipients: RecipientReport[] = members.map(({ user_id, role }) => {
    const pref = prefByUser.get(user_id);
    const tokens = tokensByUser.get(user_id) ?? [];
    const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t));

    const pushEnabled: boolean | "default" =
      pref?.push_enabled === undefined || pref?.push_enabled === null
        ? "default"
        : (pref.push_enabled as boolean);

    let categoryEnabled: boolean | "default" = "default";
    if (category) {
      const col = CATEGORY_PUSH_COLUMN[category];
      const v = pref?.[col];
      if (v === true || v === false) categoryEnabled = v;
    }

    let reason: DropReason = "delivered";
    if (pushEnabled === false) {
      reason = "global_push_disabled";
    } else if (categoryEnabled === false) {
      reason = "category_disabled";
    } else if (
      pushEnabled === "default" &&
      categoryEnabled === "default" &&
      !defaultPushEnabled(category)
    ) {
      reason = "category_disabled";
    } else if (tokens.length === 0) {
      reason = "no_token";
    } else if (validTokens.length === 0) {
      reason = "invalid_token";
    }

    return {
      userId: user_id,
      role,
      pushEnabled,
      categoryEnabled,
      tokenCount: tokens.length,
      validTokenCount: validTokens.length,
      reason,
    };
  });

  const byReason: Record<DropReason, number> = {
    delivered: 0,
    no_token: 0,
    global_push_disabled: 0,
    category_disabled: 0,
    invalid_token: 0,
  };
  for (const r of recipients) byReason[r.reason] += 1;

  return {
    audienceRoles,
    totalInAudience: recipients.length,
    delivered: byReason.delivered,
    byReason,
    recipients,
  };
}
