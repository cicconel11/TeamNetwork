import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

/**
 * Daily re-engagement sweep.
 *
 * For each user who:
 *   - has not been active in the past 7 days (users.last_active_at), AND
 *   - belongs to ≥1 org with reengagement_push_enabled=true (the per-(user,org)
 *     pref), AND
 *   - has pending activity in that org (≥1 upcoming event in the next 14d
 *     OR ≥1 announcement created in the past 14d)
 *
 * Enqueue ONE notification_jobs row, throttled to once per 14 days per user
 * via the `data.last_reengagement_at` lookup against past notifications.
 *
 * The actual delivery time defers to quiet hours via the dispatcher's
 * quiet-hours gate; we just enqueue with scheduled_for=now().
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DORMANT_DAYS = 7;
const THROTTLE_DAYS = 14;
const ACTIVITY_HORIZON_DAYS = 14;

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = service as any;

  const dormantSince = new Date(
    Date.now() - DORMANT_DAYS * 24 * 3600 * 1000,
  ).toISOString();
  const throttleSince = new Date(
    Date.now() - THROTTLE_DAYS * 24 * 3600 * 1000,
  ).toISOString();
  const upcomingHorizon = new Date(
    Date.now() + ACTIVITY_HORIZON_DAYS * 24 * 3600 * 1000,
  ).toISOString();

  // 1. Candidates: dormant users.
  const { data: dormantUsers, error: dormantErr } = await svc
    .from("users")
    .select("id, name, last_active_at")
    .or(`last_active_at.is.null,last_active_at.lt.${dormantSince}`)
    .limit(5000);

  if (dormantErr) {
    return NextResponse.json(
      { success: false, error: dormantErr.message },
      { status: 500 },
    );
  }

  const userIds = ((dormantUsers ?? []) as Array<{ id: string }>).map((u) => u.id);
  if (userIds.length === 0) {
    return NextResponse.json({ success: true, enqueued: 0 });
  }

  // 2. Throttle: skip users who already got a re-engagement push within
  // THROTTLE_DAYS. notifications.category='reengagement'.
  const { data: recent } = await svc
    .from("notifications")
    .select("user_id")
    .eq("category", "reengagement")
    .gte("created_at", throttleSince)
    .in("user_id", userIds);
  const recentlyNotified = new Set(
    ((recent ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
  );
  const eligibleUserIds = userIds.filter((id) => !recentlyNotified.has(id));

  if (eligibleUserIds.length === 0) {
    return NextResponse.json({ success: true, enqueued: 0 });
  }

  // 3. For each eligible user, find an org they belong to with
  // reengagement_push_enabled=true and pending activity. Pick the first such
  // org to send for (don't spam multiple pushes to one user even if they're
  // in several orgs).
  const { data: prefs } = await svc
    .from("notification_preferences")
    .select("user_id, organization_id")
    .eq("reengagement_push_enabled", true)
    .in("user_id", eligibleUserIds);

  const userOrgs = new Map<string, string[]>();
  for (const p of (prefs ?? []) as Array<{
    user_id: string;
    organization_id: string;
  }>) {
    const list = userOrgs.get(p.user_id) ?? [];
    list.push(p.organization_id);
    userOrgs.set(p.user_id, list);
  }

  // Aggregate org-side pending activity once.
  const allOrgIds = Array.from(
    new Set(Array.from(userOrgs.values()).flat()),
  );
  const orgsWithActivity = new Set<string>();

  if (allOrgIds.length > 0) {
    const [{ data: upcomingEvents }, { data: recentAnns }] = await Promise.all([
      svc
        .from("events")
        .select("organization_id")
        .in("organization_id", allOrgIds)
        .is("deleted_at", null)
        .gte("start_date", new Date().toISOString())
        .lte("start_date", upcomingHorizon),
      svc
        .from("announcements")
        .select("organization_id")
        .in("organization_id", allOrgIds)
        .is("deleted_at", null)
        .gte(
          "created_at",
          new Date(
            Date.now() - ACTIVITY_HORIZON_DAYS * 24 * 3600 * 1000,
          ).toISOString(),
        ),
    ]);
    for (const r of (upcomingEvents ?? []) as Array<{ organization_id: string }>) {
      orgsWithActivity.add(r.organization_id);
    }
    for (const r of (recentAnns ?? []) as Array<{ organization_id: string }>) {
      orgsWithActivity.add(r.organization_id);
    }
  }

  // 4. Build jobs.
  const orgNames = new Map<string, string>();
  if (allOrgIds.length > 0) {
    const { data: orgs } = await svc
      .from("organizations")
      .select("id, name")
      .in("id", allOrgIds);
    for (const o of (orgs ?? []) as Array<{ id: string; name: string }>) {
      orgNames.set(o.id, o.name);
    }
  }

  const jobs: Array<Record<string, unknown>> = [];
  for (const userId of eligibleUserIds) {
    const userOrgList = userOrgs.get(userId) ?? [];
    const target = userOrgList.find((o) => orgsWithActivity.has(o));
    if (!target) continue;
    const orgName = orgNames.get(target) ?? "your team";
    jobs.push({
      organization_id: target,
      kind: "standard",
      priority: 7,
      audience: null,
      target_user_ids: [userId],
      category: "reengagement",
      push_type: "reengagement",
      push_resource_id: null,
      title: `${orgName} has updates for you`,
      body: "There's new activity since you last checked in. Tap to catch up.",
      data: { reengagement: true },
      status: "pending",
      scheduled_for: new Date().toISOString(),
    });
  }

  if (jobs.length === 0) {
    return NextResponse.json({ success: true, enqueued: 0 });
  }

  const { error: insertErr } = await svc.from("notification_jobs").insert(jobs);
  if (insertErr) {
    return NextResponse.json(
      { success: false, error: insertErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, enqueued: jobs.length });
}
