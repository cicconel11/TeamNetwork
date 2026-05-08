import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

/**
 * Weekly digest fan-out.
 *
 * Schedule: every hour. For each (user, org) where digest_push_enabled=true
 * AND the user's current local time is Sunday 18:00 in their quiet-hours
 * timezone, build a one-line summary of the past week's activity and enqueue
 * a notification_jobs row delivered immediately.
 *
 * The "current local time === Sun 18:00" gate runs in SQL so we don't have to
 * read every preference row per hour and convert in JS.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface PrefRow {
  user_id: string;
  organization_id: string;
}

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = service as any;

  // 1. Find recipients: enabled + currently Sun 18:00 local.
  // Wrap the timezone math in an RPC-style query via raw SQL? Supabase JS
  // doesn't expose ad-hoc SQL on the public client. We approximate with a
  // narrower SELECT then filter in JS — small enough at MVP scale.
  const { data: prefs, error: prefErr } = await svc
    .from("notification_preferences")
    .select("user_id, organization_id, quiet_hours_timezone")
    .eq("digest_push_enabled", true);

  if (prefErr) {
    return NextResponse.json(
      { success: false, error: prefErr.message },
      { status: 500 },
    );
  }

  const now = new Date();
  const recipients: PrefRow[] = [];
  for (const p of (prefs ?? []) as Array<{
    user_id: string;
    organization_id: string;
    quiet_hours_timezone: string;
  }>) {
    try {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: p.quiet_hours_timezone,
        weekday: "short",
        hour: "2-digit",
        hour12: false,
      });
      const parts = fmt.formatToParts(now);
      const wk = parts.find((x) => x.type === "weekday")?.value ?? "";
      const hr = parseInt(
        parts.find((x) => x.type === "hour")?.value ?? "-1",
        10,
      );
      if (wk === "Sun" && hr === 18) {
        recipients.push({
          user_id: p.user_id,
          organization_id: p.organization_id,
        });
      }
    } catch {
      // Invalid timezone string — skip rather than crash the cron.
    }
  }

  if (recipients.length === 0) {
    return NextResponse.json({ success: true, enqueued: 0 });
  }

  // 2. For each org, fetch this-past-week aggregates once and reuse for all
  // recipients in that org.
  const sinceIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const orgIds = Array.from(new Set(recipients.map((r) => r.organization_id)));

  const orgStats = new Map<
    string,
    { events: number; announcements: number; discussions: number }
  >();

  for (const orgId of orgIds) {
    const [{ count: events }, { count: announcements }, { count: discussions }] =
      await Promise.all([
        svc
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .gte("created_at", sinceIso),
        svc
          .from("announcements")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .gte("created_at", sinceIso),
        svc
          .from("discussion_threads")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .gte("created_at", sinceIso),
      ]);
    orgStats.set(orgId, {
      events: events ?? 0,
      announcements: announcements ?? 0,
      discussions: discussions ?? 0,
    });
  }

  // 3. Build + insert notification_jobs rows.
  const orgNames = new Map<string, string>();
  const { data: orgs } = await svc
    .from("organizations")
    .select("id, name")
    .in("id", orgIds);
  for (const o of (orgs ?? []) as Array<{ id: string; name: string }>) {
    orgNames.set(o.id, o.name);
  }

  const jobs = recipients
    .map((r) => {
      const stats = orgStats.get(r.organization_id);
      const orgName = orgNames.get(r.organization_id) ?? "your team";
      if (!stats) return null;
      const total = stats.events + stats.announcements + stats.discussions;
      if (total === 0) return null; // nothing to digest
      const parts: string[] = [];
      if (stats.events) parts.push(`${stats.events} event${stats.events === 1 ? "" : "s"}`);
      if (stats.announcements)
        parts.push(`${stats.announcements} update${stats.announcements === 1 ? "" : "s"}`);
      if (stats.discussions)
        parts.push(`${stats.discussions} discussion${stats.discussions === 1 ? "" : "s"}`);
      return {
        organization_id: r.organization_id,
        kind: "standard",
        priority: 5,
        audience: null,
        target_user_ids: [r.user_id],
        category: "digest",
        push_type: "digest",
        push_resource_id: null,
        title: `This week in ${orgName}`,
        body: parts.join(", ") + ".",
        data: { digest: true },
        status: "pending",
        scheduled_for: new Date().toISOString(),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (jobs.length === 0) {
    return NextResponse.json({ success: true, enqueued: 0, recipients: recipients.length });
  }

  const { error: insertErr } = await svc.from("notification_jobs").insert(jobs);
  if (insertErr) {
    return NextResponse.json(
      { success: false, error: insertErr.message, recipients: recipients.length },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    enqueued: jobs.length,
    recipients: recipients.length,
  });
}
