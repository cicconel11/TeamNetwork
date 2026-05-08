import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

/**
 * Daily streak recompute + badge evaluation.
 *
 * For every (user, org) with at least one event_rsvps row checked-in within
 * the past 365 days, derive:
 *   - current_weeks: count of consecutive ISO weeks ending in the most recent
 *     calendar week (Mon UTC) where the user had ≥1 checked-in attendance.
 *   - longest_weeks: the all-time max (never decreases).
 *
 * Then evaluate seeded badges: streak milestones, events_attended, workouts.
 * Inserts into member_badges; ON CONFLICT DO NOTHING means re-runs are
 * idempotent.
 *
 * Designed for orgs with up to ~5k members. For larger scale, the SELECT
 * should move to a SQL CTE; this version processes per (org, user) in JS for
 * readability. Acceptable while we're in the ten-of-thousands rows range.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300; // streak recompute is bounded but can be slow.

interface BadgeRow {
  id: string;
  slug: string;
  criteria: { kind: string; threshold?: number };
}

interface RsvpRow {
  user_id: string;
  organization_id: string;
  checked_in_at: string;
}

interface WorkoutRow {
  user_id: string;
  organization_id: string;
}

function isoWeekStart(d: Date): Date {
  // Monday 00:00:00 UTC of the week containing d.
  const utc = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = utc.getUTCDay() || 7; // Sun=7
  utc.setUTCDate(utc.getUTCDate() - (day - 1));
  return utc;
}

function weekKey(d: Date): string {
  return isoWeekStart(d).toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = service as any;

  // 1. Pull all checked-in RSVPs over the last 365 days. The qualifying
  // signal is `status='attending' AND checked_in_at IS NOT NULL`.
  const since = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
  const { data: rsvps, error: rsvpErr } = await svc
    .from("event_rsvps")
    .select("user_id, organization_id, checked_in_at")
    .eq("status", "attending")
    .not("checked_in_at", "is", null)
    .gte("checked_in_at", since)
    .limit(100_000);

  if (rsvpErr) {
    return NextResponse.json(
      { success: false, error: rsvpErr.message },
      { status: 500 },
    );
  }

  // 2. Bucket weeks per (user, org).
  const weeksByPair = new Map<string, Set<string>>();
  for (const r of (rsvps ?? []) as RsvpRow[]) {
    const key = `${r.user_id}::${r.organization_id}`;
    const wk = weekKey(new Date(r.checked_in_at));
    let set = weeksByPair.get(key);
    if (!set) {
      set = new Set();
      weeksByPair.set(key, set);
    }
    set.add(wk);
  }

  // 3. Compute streaks. current_weeks = consecutive weeks ending in current
  // week. If current week missing, the streak ends last week (so a Sunday
  // run still counts on Monday).
  const thisWeek = weekKey(new Date());
  const lastWeek = weekKey(new Date(Date.now() - 7 * 24 * 3600 * 1000));

  const upserts: Array<{
    user_id: string;
    organization_id: string;
    current_weeks: number;
    longest_weeks: number;
    last_qualifying_week_start: string | null;
    last_recomputed_at: string;
  }> = [];

  for (const [key, weeks] of weeksByPair) {
    const [user_id, organization_id] = key.split("::");
    const sortedDesc = Array.from(weeks).sort().reverse();

    let current = 0;
    let cursor = weeks.has(thisWeek)
      ? thisWeek
      : weeks.has(lastWeek)
        ? lastWeek
        : null;
    while (cursor && weeks.has(cursor)) {
      current += 1;
      const prev = new Date(cursor + "T00:00:00Z");
      prev.setUTCDate(prev.getUTCDate() - 7);
      cursor = weekKey(prev);
    }

    // Longest: scan sorted weeks for max run.
    let longest = 0;
    let run = 0;
    let prevWk: string | null = null;
    for (const wk of sortedDesc.slice().reverse()) {
      if (prevWk === null) {
        run = 1;
      } else {
        const expected = new Date(prevWk + "T00:00:00Z");
        expected.setUTCDate(expected.getUTCDate() + 7);
        run = weekKey(expected) === wk ? run + 1 : 1;
      }
      longest = Math.max(longest, run);
      prevWk = wk;
    }

    upserts.push({
      user_id,
      organization_id,
      current_weeks: current,
      longest_weeks: longest,
      last_qualifying_week_start: sortedDesc[0] ?? null,
      last_recomputed_at: new Date().toISOString(),
    });
  }

  // 4. Upsert. We don't decrease longest_weeks here — Postgres-side guard via
  // the on-conflict update preserving the larger value.
  if (upserts.length > 0) {
    // Read existing longest values to honor the "never decreases" invariant.
    const userIds = Array.from(new Set(upserts.map((u) => u.user_id)));
    const orgIds = Array.from(new Set(upserts.map((u) => u.organization_id)));
    const { data: existing } = await svc
      .from("member_streaks")
      .select("user_id, organization_id, longest_weeks")
      .in("user_id", userIds)
      .in("organization_id", orgIds);
    const existingMap = new Map<string, number>();
    for (const e of (existing ?? []) as Array<{
      user_id: string;
      organization_id: string;
      longest_weeks: number;
    }>) {
      existingMap.set(`${e.user_id}::${e.organization_id}`, e.longest_weeks);
    }
    for (const u of upserts) {
      const key = `${u.user_id}::${u.organization_id}`;
      const prior = existingMap.get(key) ?? 0;
      if (prior > u.longest_weeks) u.longest_weeks = prior;
    }

    const { error: upsertErr } = await svc
      .from("member_streaks")
      .upsert(upserts, { onConflict: "user_id,organization_id" });
    if (upsertErr) {
      return NextResponse.json(
        { success: false, error: upsertErr.message },
        { status: 500 },
      );
    }
  }

  // 5. Badge evaluation. Pull catalog + (per pair) total attended events +
  // workouts logged. Insert any newly-earned rows; ON CONFLICT DO NOTHING.
  const { data: badges } = await svc
    .from("badges")
    .select("id, slug, criteria");
  const badgeRows = (badges ?? []) as BadgeRow[];

  const eventsAttended = new Map<string, number>();
  for (const r of (rsvps ?? []) as RsvpRow[]) {
    const k = `${r.user_id}::${r.organization_id}`;
    eventsAttended.set(k, (eventsAttended.get(k) ?? 0) + 1);
  }

  // Workouts logged: any row in workout_logs counts.
  const { data: wRows } = await svc
    .from("workout_logs")
    .select("user_id, organization_id");
  const workoutsLogged = new Map<string, number>();
  for (const w of (wRows ?? []) as WorkoutRow[]) {
    const k = `${w.user_id}::${w.organization_id}`;
    workoutsLogged.set(k, (workoutsLogged.get(k) ?? 0) + 1);
  }

  const awards: Array<{
    user_id: string;
    organization_id: string;
    badge_id: string;
  }> = [];
  for (const upsert of upserts) {
    const k = `${upsert.user_id}::${upsert.organization_id}`;
    const ea = eventsAttended.get(k) ?? 0;
    const wl = workoutsLogged.get(k) ?? 0;
    for (const b of badgeRows) {
      const c = b.criteria;
      let earned = false;
      if (c.kind === "streak_weeks" && (c.threshold ?? 0) > 0) {
        earned = upsert.longest_weeks >= (c.threshold ?? 0);
      } else if (c.kind === "events_attended" && (c.threshold ?? 0) > 0) {
        earned = ea >= (c.threshold ?? 0);
      } else if (c.kind === "workouts_logged" && (c.threshold ?? 0) > 0) {
        earned = wl >= (c.threshold ?? 0);
      }
      if (earned) {
        awards.push({
          user_id: upsert.user_id,
          organization_id: upsert.organization_id,
          badge_id: b.id,
        });
      }
    }
  }

  if (awards.length > 0) {
    // Use upsert with onConflict: ignore — Supabase doesn't expose ON CONFLICT
    // DO NOTHING directly, but ignoreDuplicates on the unique key works.
    const { error: awardErr } = await svc
      .from("member_badges")
      .upsert(awards, {
        onConflict: "user_id,organization_id,badge_id",
        ignoreDuplicates: true,
      });
    if (awardErr) {
      return NextResponse.json(
        {
          success: false,
          error: `streaks ok, badges failed: ${awardErr.message}`,
          streaks: upserts.length,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    success: true,
    streaksUpserted: upserts.length,
    badgeAwards: awards.length,
  });
}
