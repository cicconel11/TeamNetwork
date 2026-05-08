import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

/**
 * Event reminder cron — every minute, finds events starting in the next
 * 29–30 minute window and enqueues a single push notification job per event
 * targeting users who RSVP'd `attending`. Dedup'd via `event_reminder_sends`
 * so each reminder fires at most once per (event_id, kind).
 *
 * The actual push send happens in `notification-dispatch` (this cron only
 * enqueues `notification_jobs` rows). Tap-through is handled by mobile via
 * `push_type='event' + push_resource_id`.
 */
export const dynamic = "force-dynamic";

const REMINDER_KIND = "30m";
const WINDOW_LOW_MINUTES = 29;
const WINDOW_HIGH_MINUTES = 30;

interface EventRow {
  id: string;
  organization_id: string;
  title: string | null;
  start_date: string;
}

interface OrgRow {
  id: string;
  slug: string;
}

interface RsvpRow {
  event_id: string;
  user_id: string;
}

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const service = createServiceClient();
  const startedAt = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = service as any;

  const now = new Date();
  const lowerBound = new Date(now.getTime() + WINDOW_LOW_MINUTES * 60_000).toISOString();
  const upperBound = new Date(now.getTime() + WINDOW_HIGH_MINUTES * 60_000).toISOString();

  // 1. Candidate events in the firing window.
  const { data: events, error: eventsError } = await svc
    .from("events")
    .select("id, organization_id, title, start_date")
    .is("deleted_at", null)
    .gt("start_date", lowerBound)
    .lte("start_date", upperBound);

  if (eventsError) {
    console.error("[event-reminders] events query failed:", eventsError.message);
    return NextResponse.json(
      { success: false, error: eventsError.message },
      { status: 500 },
    );
  }

  const candidates = (events ?? []) as EventRow[];
  if (candidates.length === 0) {
    return NextResponse.json({ success: true, considered: 0, enqueued: 0 });
  }

  // 2. Filter out events whose 30m reminder has already been recorded.
  const candidateIds = candidates.map((e) => e.id);
  const { data: alreadySent, error: dedupError } = await svc
    .from("event_reminder_sends")
    .select("event_id")
    .eq("kind", REMINDER_KIND)
    .in("event_id", candidateIds);

  if (dedupError) {
    console.error("[event-reminders] dedup query failed:", dedupError.message);
    return NextResponse.json(
      { success: false, error: dedupError.message },
      { status: 500 },
    );
  }

  const sentIds = new Set(
    ((alreadySent ?? []) as Array<{ event_id: string }>).map((r) => r.event_id),
  );
  const pending = candidates.filter((e) => !sentIds.has(e.id));

  if (pending.length === 0) {
    return NextResponse.json({
      success: true,
      considered: candidates.length,
      enqueued: 0,
    });
  }

  // 3. Org slugs for deep-link routing.
  const orgIds = Array.from(new Set(pending.map((e) => e.organization_id)));
  const { data: orgs, error: orgsError } = await svc
    .from("organizations")
    .select("id, slug")
    .in("id", orgIds);

  if (orgsError) {
    console.error("[event-reminders] org slug query failed:", orgsError.message);
    return NextResponse.json(
      { success: false, error: orgsError.message },
      { status: 500 },
    );
  }
  const slugByOrgId = new Map(((orgs ?? []) as OrgRow[]).map((o) => [o.id, o.slug]));

  // 4. Attending RSVPs for all pending events in one query.
  const pendingIds = pending.map((e) => e.id);
  const { data: rsvps, error: rsvpsError } = await svc
    .from("event_rsvps")
    .select("event_id, user_id")
    .eq("status", "attending")
    .in("event_id", pendingIds);

  if (rsvpsError) {
    console.error("[event-reminders] rsvp query failed:", rsvpsError.message);
    return NextResponse.json(
      { success: false, error: rsvpsError.message },
      { status: 500 },
    );
  }

  const usersByEvent = new Map<string, string[]>();
  for (const row of (rsvps ?? []) as RsvpRow[]) {
    const list = usersByEvent.get(row.event_id) ?? [];
    list.push(row.user_id);
    usersByEvent.set(row.event_id, list);
  }

  // 5. Per event: enqueue notification_jobs row (if recipients), then write
  //    dedup row regardless so we don't re-evaluate next minute.
  const results: Array<{ eventId: string; enqueued: boolean; recipients: number }> = [];
  let enqueued = 0;

  for (const event of pending) {
    const recipients = usersByEvent.get(event.id) ?? [];
    let didEnqueue = false;

    if (recipients.length > 0) {
      const orgSlug = slugByOrgId.get(event.organization_id);
      const title = event.title?.trim() || "Upcoming event";
      const { error: insertError } = await svc
        .from("notification_jobs")
        .insert({
          organization_id: event.organization_id,
          kind: "standard",
          audience: "individuals",
          target_user_ids: recipients,
          category: "event_reminder",
          push_type: "event",
          push_resource_id: event.id,
          title,
          body: "Starts in 30 minutes",
          data: {
            orgSlug,
            eventId: event.id,
            type: "event_starting_soon",
          },
          scheduled_for: new Date().toISOString(),
        });

      if (insertError) {
        console.error(
          `[event-reminders] enqueue failed for event ${event.id}: ${insertError.message}`,
        );
        results.push({ eventId: event.id, enqueued: false, recipients: recipients.length });
        // Don't write dedup row — let next minute retry.
        continue;
      }

      didEnqueue = true;
      enqueued += 1;
    }

    const { error: dedupInsertError } = await svc
      .from("event_reminder_sends")
      .insert({ event_id: event.id, kind: REMINDER_KIND });

    if (dedupInsertError) {
      // Unique-violation is benign (another worker won the race). Anything
      // else we log but don't fail the whole batch.
      if (dedupInsertError.code !== "23505") {
        console.error(
          `[event-reminders] dedup insert failed for event ${event.id}: ${dedupInsertError.message}`,
        );
      }
    }

    results.push({ eventId: event.id, enqueued: didEnqueue, recipients: recipients.length });
  }

  return NextResponse.json({
    success: true,
    considered: candidates.length,
    enqueued,
    elapsedMs: Date.now() - startedAt,
    results,
  });
}
