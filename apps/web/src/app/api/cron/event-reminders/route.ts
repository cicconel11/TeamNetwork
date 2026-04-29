import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import { sendPush } from "@/lib/notifications/push";
import { auditNotificationSend } from "@/lib/notifications/audit";

/**
 * Event reminder cron.
 *
 * Fires push notifications for events the user RSVP'd "attending" to:
 *   - 24h before start_date  (window: now+23h45m..now+24h15m)
 *   - 1h before start_date   (window: now+45m..now+1h15m)
 *
 * Runs every 5 minutes from Vercel cron. Idempotency is enforced at the DB
 * layer via the unique partial index `notification_jobs_reminder_dedup_idx`
 * on (push_type, push_resource_id, data->>'reminder_window'); we INSERT first
 * with `ON CONFLICT DO NOTHING`, and only fan out push if the insert produced
 * a row. That way overlapping cron windows (5-min cadence × 30-min window)
 * never double-send.
 */
export const dynamic = "force-dynamic";

const REMINDER_WINDOWS = [
  {
    label: "1h" as const,
    leadMinutes: 60,
    halfWindowMinutes: 15,
    titlePrefix: "Starting soon",
  },
  {
    label: "24h" as const,
    leadMinutes: 24 * 60,
    halfWindowMinutes: 15,
    titlePrefix: "Tomorrow",
  },
];

interface EventRow {
  id: string;
  organization_id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  location: string | null;
}

interface RsvpRow {
  user_id: string;
}

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const service = createServiceClient();
  const now = Date.now();

  const summary: Array<{
    window: "1h" | "24h";
    eventId: string;
    inserted: boolean;
    pushed: number;
    skipped: number;
    errors: string[];
  }> = [];

  for (const window of REMINDER_WINDOWS) {
    const lower = new Date(
      now + (window.leadMinutes - window.halfWindowMinutes) * 60 * 1000
    ).toISOString();
    const upper = new Date(
      now + (window.leadMinutes + window.halfWindowMinutes) * 60 * 1000
    ).toISOString();

    const { data: events, error: eventsError } = await service
      .from("events")
      .select("id, organization_id, title, start_date, end_date, location")
      .gte("start_date", lower)
      .lt("start_date", upper)
      .is("deleted_at", null);

    if (eventsError) {
      console.error("[event-reminders] Failed to load events:", eventsError);
      continue;
    }

    for (const event of (events ?? []) as EventRow[]) {
      // Dedup: try to claim this (event, window) combo. ON CONFLICT DO NOTHING
      // via the partial unique index. If the insert returns a row, we own it.
      // If it returns nothing, another cron tick already handled this window.
      const { data: claimed, error: claimError } = await (service as unknown as {
        from: (table: string) => {
          insert: (v: Record<string, unknown>) => {
            select: (cols: string) => Promise<{
              data: Array<{ id: string }> | null;
              error: { message: string } | null;
            }>;
          };
        };
      })
        .from("notification_jobs")
        .insert({
          organization_id: event.organization_id,
          kind: "standard",
          priority: 5,
          push_type: "event_reminder",
          push_resource_id: event.id,
          category: "event_reminder",
          title: `${window.titlePrefix}: ${event.title}`,
          body: buildReminderBody(event),
          data: { reminder_window: window.label, event_id: event.id },
          status: "succeeded",
          sent_at: new Date().toISOString(),
        })
        .select("id");

      if (claimError) {
        // Unique-violation = already sent. Anything else is a real error.
        const msg = claimError.message;
        const isDuplicate =
          msg.includes("notification_jobs_reminder_dedup_idx") ||
          msg.includes("duplicate key value");
        if (isDuplicate) {
          summary.push({
            window: window.label,
            eventId: event.id,
            inserted: false,
            pushed: 0,
            skipped: 0,
            errors: [],
          });
          continue;
        }
        console.error("[event-reminders] Insert failed:", msg);
        summary.push({
          window: window.label,
          eventId: event.id,
          inserted: false,
          pushed: 0,
          skipped: 0,
          errors: [msg],
        });
        continue;
      }

      if (!claimed || claimed.length === 0) {
        // Defensive: shouldn't happen given we passed select(), but treat as
        // already-handled.
        summary.push({
          window: window.label,
          eventId: event.id,
          inserted: false,
          pushed: 0,
          skipped: 0,
          errors: [],
        });
        continue;
      }

      // Find users who RSVP'd attending.
      const { data: rsvps, error: rsvpError } = await service
        .from("event_rsvps")
        .select("user_id")
        .eq("event_id", event.id)
        .eq("status", "attending");

      if (rsvpError) {
        summary.push({
          window: window.label,
          eventId: event.id,
          inserted: true,
          pushed: 0,
          skipped: 0,
          errors: [rsvpError.message],
        });
        continue;
      }

      const userIds = (rsvps as RsvpRow[] | null)?.map((r) => r.user_id) ?? [];
      if (userIds.length === 0) {
        summary.push({
          window: window.label,
          eventId: event.id,
          inserted: true,
          pushed: 0,
          skipped: 0,
          errors: [],
        });
        continue;
      }

      const { data: orgRow } = await service
        .from("organizations")
        .select("slug")
        .eq("id", event.organization_id)
        .maybeSingle();
      const orgSlug = (orgRow as { slug?: string } | null)?.slug;

      const reminderTitle = `${window.titlePrefix}: ${event.title}`;
      const reminderBody = buildReminderBody(event);

      const result = await sendPush({
        supabase: service,
        organizationId: event.organization_id,
        targetUserIds: userIds,
        title: reminderTitle,
        body: reminderBody,
        category: "event_reminder",
        pushType: "event_reminder",
        pushResourceId: event.id,
        orgSlug,
      });

      // Audit-log the dispatch so admins can see reminder sends in the
      // notifications dashboard alongside admin-broadcast announcements.
      if (result.sent > 0) {
        await auditNotificationSend(service, {
          organizationId: event.organization_id,
          kind: "standard",
          title: reminderTitle,
          body: reminderBody,
          audience: null,
          targetUserIds: userIds,
          sentAt: new Date().toISOString(),
        });
      }

      summary.push({
        window: window.label,
        eventId: event.id,
        inserted: true,
        pushed: result.sent,
        skipped: result.skipped,
        errors: result.errors,
      });
    }
  }

  const totalPushed = summary.reduce((sum, s) => sum + s.pushed, 0);
  return NextResponse.json({
    success: true,
    totalPushed,
    rows: summary,
  });
}

function buildReminderBody(event: EventRow): string {
  const start = new Date(event.start_date);
  const time = start.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return event.location ? `${time} · ${event.location}` : time;
}
