/**
 * Quiet-hours gate for the notification dispatcher.
 *
 * Categories that respect quiet hours: digest, reengagement. Transactional
 * categories (chat, event_reminder, announcement, mention) bypass — if you
 * @-mention me at 11pm I'd rather be pinged than wait until morning.
 *
 * Logic:
 *   1. For single-target pushes in a respecting category, look up the
 *      user's quiet_hours_{start,end,timezone} on notification_preferences
 *      scoped to the job's organization.
 *   2. If `now` falls inside the local-time window, compute the next
 *      quiet_hours_end as a UTC ISO string and return it as the deferred
 *      scheduled_for.
 *   3. Otherwise return null — caller proceeds with normal dispatch.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const RESPECTING_CATEGORIES = new Set(["digest", "reengagement"]);

interface QuietHoursPref {
  quiet_hours_start: string; // 'HH:MM:SS' or 'HH:MM'
  quiet_hours_end: string;
  quiet_hours_timezone: string;
}

function parseHM(value: string): { h: number; m: number } {
  const [h, m] = value.split(":");
  return { h: parseInt(h, 10) || 0, m: parseInt(m ?? "0", 10) || 0 };
}

/** Returns local hour:minute in given IANA timezone for `now`. */
function localHM(now: Date, tz: string): { h: number; m: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const h = parseInt(parts.find((x) => x.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((x) => x.type === "minute")?.value ?? "0", 10);
  return { h, m };
}

function isInsideWindow(
  now: Date,
  pref: QuietHoursPref,
): { inside: boolean; minutesUntilEnd: number } {
  const start = parseHM(pref.quiet_hours_start);
  const end = parseHM(pref.quiet_hours_end);
  const cur = localHM(now, pref.quiet_hours_timezone);

  const startMin = start.h * 60 + start.m;
  const endMin = end.h * 60 + end.m;
  const curMin = cur.h * 60 + cur.m;

  // Window may wrap midnight (start > end). Default 21:00–07:00 wraps.
  const wraps = startMin > endMin;
  const inside = wraps
    ? curMin >= startMin || curMin < endMin
    : curMin >= startMin && curMin < endMin;
  if (!inside) return { inside: false, minutesUntilEnd: 0 };

  const minutesUntilEnd = wraps
    ? curMin >= startMin
      ? 24 * 60 - curMin + endMin
      : endMin - curMin
    : endMin - curMin;
  return { inside: true, minutesUntilEnd };
}

/**
 * Returns an ISO string for `scheduled_for` if the job should be deferred,
 * or null if it should proceed now.
 */
export async function maybeDeferForQuietHours(args: {
  supabase: SupabaseClient;
  category: string | null | undefined;
  organizationId: string;
  targetUserIds: string[] | null;
  now?: Date;
}): Promise<string | null> {
  const { supabase, category, organizationId, targetUserIds } = args;
  if (!category || !RESPECTING_CATEGORIES.has(category)) return null;
  if (!targetUserIds || targetUserIds.length !== 1) return null;

  const userId = targetUserIds[0];
  const now = args.now ?? new Date();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = supabase as any;
  const { data: pref } = await svc
    .from("notification_preferences")
    .select("quiet_hours_start, quiet_hours_end, quiet_hours_timezone")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!pref) return null;
  const result = isInsideWindow(now, pref as QuietHoursPref);
  if (!result.inside) return null;

  const deferTo = new Date(now.getTime() + result.minutesUntilEnd * 60 * 1000);
  return deferTo.toISOString();
}
