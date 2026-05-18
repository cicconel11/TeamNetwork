/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { isStageTimeoutError } from "@/lib/ai/timeout";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError, type ToolExecutionResult } from "@/lib/ai/tools/result";
import { expandAcademicSchedule } from "@/lib/calendar/unified-events";
import {
  fetchTeamAvailabilitySources,
  type NormalizedTeamEvent,
} from "@/lib/calendar/team-availability";
import type { ToolModule } from "./types";

const MAX_WINDOW_DAYS = 14;
const MIN_HOUR = 6;
const MAX_HOUR = 22;

const findFreeMembersSchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    sport: z.string().trim().min(1).max(60).optional(),
    min_free: z.number().int().min(1).max(500).optional(),
  })
  .strict();

type Args = z.infer<typeof findFreeMembersSchema>;

interface MemberLite {
  user_id: string;
  name: string;
}

interface AcademicScheduleRow {
  id: string;
  user_id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string;
  end_time: string;
  occurrence_type: string;
  day_of_week: number[] | null;
  day_of_month: number | null;
}

interface HourBucket {
  hour_key: string;
  hour_start: string;
  hour_end: string;
  free: MemberLite[];
  busy: { user_id: string; name: string; reason: string }[];
  free_count: number;
}

export const findFreeMembersModule: ToolModule<Args> = {
  name: "find_free_members",
  argsSchema: findFreeMembersSchema,
  async execute(args, { ctx, sb, logContext }) {
    return runFindFreeMembers(sb, ctx.orgId, args, logContext);
  },
};

function clampToHour(date: Date, mode: "floor" | "ceil"): Date {
  const copy = new Date(date);
  if (copy.getUTCMinutes() === 0 && copy.getUTCSeconds() === 0 && copy.getUTCMilliseconds() === 0) {
    return copy;
  }
  copy.setUTCMinutes(0, 0, 0);
  if (mode === "ceil") {
    copy.setUTCHours(copy.getUTCHours() + 1);
  }
  return copy;
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

async function runFindFreeMembers(
  sb: any,
  orgId: string,
  args: Args,
  logContext: AiLogContext,
): Promise<ToolExecutionResult> {
  const start = new Date(args.start);
  const end = new Date(args.end);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return toolError("Invalid window");
  }
  if (start >= end) {
    return toolError("start must be before end");
  }
  const windowMs = end.getTime() - start.getTime();
  if (windowMs > MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    return toolError(`Window cannot exceed ${MAX_WINDOW_DAYS} days`);
  }

  try {
    // Resolve org member set
    const { data: memberRows, error: memberError } = await sb
      .from("members")
      .select("user_id, first_name, last_name, email")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .eq("status", "active");

    if (memberError) {
      aiLog("warn", "ai-tools", "find_free_members members query failed", logContext, {
        error: getSafeErrorMessage(memberError),
      });
      return toolError("Query failed");
    }

    const memberList: MemberLite[] = [];
    const memberById = new Map<string, MemberLite>();
    const userIds: string[] = [];
    for (const row of Array.isArray(memberRows) ? memberRows : []) {
      if (typeof row.user_id !== "string" || row.user_id.length === 0) continue;
      const composed = [row.first_name, row.last_name]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .map((part) => part.trim())
        .join(" ")
        .trim();
      const fallback = typeof row.email === "string" ? row.email : "";
      const name = composed.length > 0 ? composed : fallback || "Member";
      const member = { user_id: row.user_id, name };
      memberList.push(member);
      memberById.set(row.user_id, member);
      userIds.push(row.user_id);
    }

    // Resolve user names where members lack first/last
    if (userIds.length > 0) {
      const { data: userRows, error: userError } = await sb
        .from("users")
        .select("id, name")
        .in("id", userIds);
      if (userError) {
        aiLog("warn", "ai-tools", "find_free_members user lookup failed", logContext, {
          error: getSafeErrorMessage(userError),
        });
        // Non-fatal — fall back to member name resolution above
      } else if (Array.isArray(userRows)) {
        for (const row of userRows) {
          if (typeof row.id !== "string") continue;
          const existing = memberById.get(row.id);
          if (existing && (existing.name === "Member" || existing.name === "")) {
            if (typeof row.name === "string" && row.name.trim().length > 0) {
              existing.name = row.name.trim();
            }
          }
        }
      }
    }

    // Fetch academic_schedules for all org members + org-wide event sources in parallel
    const [academicResult, teamSources] = await Promise.all([
      userIds.length > 0
        ? sb
            .from("academic_schedules")
            .select(
              "id, user_id, title, start_date, end_date, start_time, end_time, occurrence_type, day_of_week, day_of_month",
            )
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .in("user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
      fetchTeamAvailabilitySources({ supabase: sb, orgId, start, end }),
    ]);

    if (academicResult.error) {
      aiLog("warn", "ai-tools", "find_free_members academic_schedules query failed", logContext, {
        error: getSafeErrorMessage(academicResult.error),
      });
      return toolError("Query failed");
    }

    if (teamSources.scheduleError || teamSources.orgError) {
      aiLog("warn", "ai-tools", "find_free_members team sources partial error", logContext, {
        error: getSafeErrorMessage(teamSources.scheduleError ?? teamSources.orgError),
      });
    }

    const academicRows = (Array.isArray(academicResult.data) ? academicResult.data : []) as AcademicScheduleRow[];
    const orgWideBusy: NormalizedTeamEvent[] = teamSources.normalized;

    const hasAnyAcademic = academicRows.length > 0;
    const hasAnyOrgWide = orgWideBusy.length > 0;

    if (memberList.length === 0 || (!hasAnyAcademic && !hasAnyOrgWide)) {
      aiLog("info", "ai-tools", "find_free_members no_data", logContext, {
        total_members: memberList.length,
        has_academic: hasAnyAcademic,
        has_org_wide: hasAnyOrgWide,
      });
      return {
        kind: "ok",
        data: {
          state: "no_data",
          window: { start: args.start, end: args.end },
          total_members: memberList.length,
          hours: [],
        },
      };
    }

    // Expand academic_schedules into time ranges per user, optionally filtered by sport (title match)
    const sportFilter = args.sport?.toLowerCase();
    type UserBusy = { userId: string; start: Date; end: Date; title: string };
    const userBusy: UserBusy[] = [];
    for (const row of academicRows) {
      if (sportFilter) {
        const haystack = `${row.title ?? ""}`.toLowerCase();
        if (!haystack.includes(sportFilter)) continue;
      }
      const expanded = expandAcademicSchedule(
        {
          id: row.id,
          title: row.title,
          start_date: row.start_date,
          end_date: row.end_date,
          start_time: row.start_time,
          end_time: row.end_time,
          occurrence_type: row.occurrence_type,
          day_of_week: row.day_of_week,
          day_of_month: row.day_of_month,
        },
        start,
        end,
      );
      for (const ev of expanded) {
        if (!ev.endAt) continue;
        userBusy.push({
          userId: row.user_id,
          start: new Date(ev.startAt),
          end: new Date(ev.endAt),
          title: row.title,
        });
      }
    }

    // Build hour buckets
    const hourBucketStart = clampToHour(start, "floor");
    const hourBucketEnd = clampToHour(end, "ceil");
    const hours: HourBucket[] = [];

    for (
      let cursor = new Date(hourBucketStart);
      cursor.getTime() < hourBucketEnd.getTime();
      cursor = new Date(cursor.getTime() + 60 * 60 * 1000)
    ) {
      const hourStart = new Date(cursor);
      const hourEnd = new Date(cursor.getTime() + 60 * 60 * 1000);

      // Match TeamAvailabilityRows hour window (6-22 UTC hours used as a coarse working-day filter)
      const hourOfDay = hourStart.getUTCHours();
      if (hourOfDay < MIN_HOUR || hourOfDay >= MAX_HOUR) continue;

      const busyUserIds = new Set<string>();
      const busyReasons = new Map<string, string>();

      // Org-wide events mark everyone busy
      let orgWideTitle: string | null = null;
      for (const ev of orgWideBusy) {
        if (!ev.end_at) continue;
        const evStart = new Date(ev.start_at);
        const evEnd = new Date(ev.end_at);
        if (rangesOverlap(hourStart, hourEnd, evStart, evEnd)) {
          orgWideTitle = ev.title;
          break;
        }
      }
      if (orgWideTitle) {
        for (const member of memberList) {
          busyUserIds.add(member.user_id);
          busyReasons.set(member.user_id, orgWideTitle);
        }
      }

      // Per-user academic schedule conflicts
      for (const busy of userBusy) {
        if (rangesOverlap(hourStart, hourEnd, busy.start, busy.end)) {
          busyUserIds.add(busy.userId);
          if (!busyReasons.has(busy.userId)) {
            busyReasons.set(busy.userId, busy.title);
          }
        }
      }

      const free: MemberLite[] = [];
      const busy: { user_id: string; name: string; reason: string }[] = [];
      for (const member of memberList) {
        if (busyUserIds.has(member.user_id)) {
          busy.push({
            user_id: member.user_id,
            name: member.name,
            reason: busyReasons.get(member.user_id) ?? "Unavailable",
          });
        } else {
          free.push(member);
        }
      }

      const hour_key = `${hourStart.toISOString().slice(0, 13)}:00`;
      hours.push({
        hour_key,
        hour_start: hourStart.toISOString(),
        hour_end: hourEnd.toISOString(),
        free,
        busy,
        free_count: free.length,
      });
    }

    const minFree = args.min_free ?? 0;
    const filteredHours = minFree > 0 ? hours.filter((h) => h.free_count >= minFree) : hours;

    aiLog("info", "ai-tools", "find_free_members completed", logContext, {
      total_members: memberList.length,
      hours_returned: filteredHours.length,
      academic_rows: academicRows.length,
      org_wide_events: orgWideBusy.length,
      sport_filter: args.sport ?? null,
      min_free: minFree,
    });

    return {
      kind: "ok",
      data: {
        state: "resolved",
        window: { start: args.start, end: args.end },
        total_members: memberList.length,
        hours: filteredHours,
      },
    };
  } catch (error) {
    if (isStageTimeoutError(error)) throw error;
    aiLog("warn", "ai-tools", "find_free_members failed", logContext, {
      error: getSafeErrorMessage(error),
    });
    return toolError("Unexpected error");
  }
}
