import type { SupabaseClient } from "@supabase/supabase-js";
import { eventOverlapsRange } from "@/lib/calendar/event-segments";

export const TEAM_AVAILABILITY_MAX_EVENTS = 500;

export type ScheduleEventRow = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  location: string | null;
  status: string | null;
};

export type OrgEventRow = {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  location: string | null;
  event_type: string | null;
  organization_id: string;
  audience: string | null;
  target_user_ids: string[] | null;
};

export type NormalizedTeamEvent = {
  id: string;
  title: string;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  location: string | null;
  feed_id: string | null;
  user_id: string;
  origin: "schedule" | "org";
};

export type TeamAvailabilityMembership = {
  role: string | null;
  userId: string;
};

export type FetchTeamAvailabilityParams = {
  supabase: SupabaseClient;
  orgId: string;
  start: Date;
  end: Date;
  membership?: TeamAvailabilityMembership;
  maxEvents?: number;
};

export type FetchTeamAvailabilityResult = {
  scheduleEvents: ScheduleEventRow[];
  orgEvents: OrgEventRow[];
  normalized: NormalizedTeamEvent[];
  scheduleError: unknown | null;
  orgError: unknown | null;
};

function audienceVisibleTo(audience: string | null, role: string | null): boolean {
  switch (audience) {
    case "members":
      return role === "admin" || role === "active_member" || role === "member";
    case "alumni":
      return role === "alumni";
    case "all":
    case "both":
    case null:
      return true;
    default:
      return true;
  }
}

export async function fetchTeamAvailabilitySources(
  params: FetchTeamAvailabilityParams,
): Promise<FetchTeamAvailabilityResult> {
  const { supabase, orgId, start, end, membership } = params;
  const maxEvents = params.maxEvents ?? TEAM_AVAILABILITY_MAX_EVENTS;

  const [scheduleResult, orgResult] = await Promise.all([
    supabase
      .from("schedule_events")
      .select("id, title, start_at, end_at, location, status")
      .eq("org_id", orgId)
      .neq("status", "cancelled")
      .lte("start_at", end.toISOString())
      .gte("end_at", start.toISOString())
      .limit(maxEvents + 1)
      .order("start_at", { ascending: true }),

    supabase
      .from("events")
      .select(
        "id, title, start_date, end_date, location, event_type, organization_id, audience, target_user_ids",
      )
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .lte("start_date", end.toISOString())
      .or(`end_date.gte.${start.toISOString()},end_date.is.null`)
      .limit(maxEvents + 1)
      .order("start_date", { ascending: true }),
  ]);

  const scheduleEvents = (scheduleResult.data ?? []) as ScheduleEventRow[];
  const orgEvents = (orgResult.data ?? []) as OrgEventRow[];

  const normalizedSchedule: NormalizedTeamEvent[] = scheduleEvents
    .filter((event) =>
      eventOverlapsRange(
        { startAt: event.start_at, endAt: event.end_at, allDay: false },
        start,
        end,
      ),
    )
    .map((event) => ({
      id: `schedule:${event.id}`,
      title: event.title,
      start_at: event.start_at,
      end_at: event.end_at,
      all_day: false,
      location: event.location,
      feed_id: null,
      user_id: `org:${orgId}`,
      origin: "schedule" as const,
    }));

  const normalizedOrg: NormalizedTeamEvent[] = orgEvents
    .filter((event) => {
      const targetUserIds = Array.isArray(event.target_user_ids) ? event.target_user_ids : [];
      if (targetUserIds.length > 0) {
        if (!membership) return true;
        return targetUserIds.includes(membership.userId);
      }
      return audienceVisibleTo(event.audience, membership?.role ?? null);
    })
    .filter((event) =>
      eventOverlapsRange(
        { startAt: event.start_date, endAt: event.end_date, allDay: false },
        start,
        end,
      ),
    )
    .map((event) => ({
      id: `org:${event.id}`,
      title: event.title,
      start_at: event.start_date,
      end_at: event.end_date,
      all_day: false,
      location: event.location,
      feed_id: null,
      user_id: `org:${orgId}`,
      origin: "org" as const,
    }));

  return {
    scheduleEvents,
    orgEvents,
    normalized: [...normalizedSchedule, ...normalizedOrg],
    scheduleError: scheduleResult.error ?? null,
    orgError: orgResult.error ?? null,
  };
}
