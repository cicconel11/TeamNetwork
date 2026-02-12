/**
 * Pure functions for expanding recurrence rules into concrete event instance dates.
 *
 * The "pre-expand" approach creates individual event rows for each occurrence,
 * making RSVPs, notifications, and calendar sync work with zero extra logic.
 *
 * All date arithmetic uses UTC to avoid timezone-dependent behavior.
 */

export type OccurrenceType = "daily" | "weekly" | "monthly";

export interface RecurrenceRule {
  occurrence_type: OccurrenceType;
  day_of_week?: number[];       // 0-6 (Sunday=0), weekly only
  day_of_month?: number;        // 1-31, monthly only
  recurrence_end_date?: string; // "YYYY-MM-DD", defaults to 6 months from start
}

export interface EventInstanceDate {
  start_date: string;  // ISO datetime
  end_date: string | null;  // ISO datetime or null
  recurrence_index: number;
}

/** Hard caps to prevent runaway expansion */
const MAX_INSTANCES: Record<OccurrenceType, number> = {
  weekly: 52,
  daily: 180,
  monthly: 12,
};

/** Default end date: 6 months from start */
const DEFAULT_END_MONTHS = 6;

/**
 * Expand a recurrence rule into concrete instance dates.
 *
 * @param startDate  ISO datetime of the first event instance
 * @param endDate    ISO datetime of the first event's end (null if no end time)
 * @param rule       Recurrence rule describing the pattern
 * @returns Array of EventInstanceDate, including the first instance at index 0
 */
export function expandRecurrence(
  startDate: string,
  endDate: string | null,
  rule: RecurrenceRule,
): EventInstanceDate[] {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;

  // Duration offset in ms (preserved across all instances)
  const durationMs = end ? end.getTime() - start.getTime() : 0;

  // Determine the recurrence boundary (end of the specified day in UTC)
  const recurrenceEnd = rule.recurrence_end_date
    ? endOfDayUTC(new Date(rule.recurrence_end_date + "T00:00:00Z"))
    : addMonthsUTC(start, DEFAULT_END_MONTHS);

  const maxInstances = MAX_INSTANCES[rule.occurrence_type];

  switch (rule.occurrence_type) {
    case "daily":
      return expandDaily(start, durationMs, end !== null, recurrenceEnd, maxInstances);
    case "weekly":
      return expandWeekly(start, durationMs, end !== null, recurrenceEnd, maxInstances, rule.day_of_week ?? [start.getUTCDay()]);
    case "monthly":
      return expandMonthly(start, durationMs, end !== null, recurrenceEnd, maxInstances, rule.day_of_month ?? start.getUTCDate());
    default:
      return [];
  }
}

function expandDaily(
  start: Date,
  durationMs: number,
  hasEnd: boolean,
  recurrenceEnd: Date,
  maxInstances: number,
): EventInstanceDate[] {
  const instances: EventInstanceDate[] = [];
  const cursor = new Date(start);

  while (cursor <= recurrenceEnd && instances.length < maxInstances) {
    instances.push(makeInstance(cursor, durationMs, hasEnd, instances.length));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return instances;
}

function expandWeekly(
  start: Date,
  durationMs: number,
  hasEnd: boolean,
  recurrenceEnd: Date,
  maxInstances: number,
  daysOfWeek: number[],
): EventInstanceDate[] {
  const instances: EventInstanceDate[] = [];
  const sortedDays = [...daysOfWeek].sort((a, b) => a - b);
  const cursor = new Date(start);

  while (cursor <= recurrenceEnd && instances.length < maxInstances) {
    if (sortedDays.includes(cursor.getUTCDay())) {
      if (cursor >= start) {
        instances.push(makeInstance(
          setUTCTimeFrom(cursor, start),
          durationMs,
          hasEnd,
          instances.length,
        ));
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return instances;
}

function expandMonthly(
  start: Date,
  durationMs: number,
  hasEnd: boolean,
  recurrenceEnd: Date,
  maxInstances: number,
  dayOfMonth: number,
): EventInstanceDate[] {
  const instances: EventInstanceDate[] = [];
  // Track months to iterate by month index, not cursor date
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();

  while (instances.length < maxInstances) {
    // Clamp to last day of month for short months (e.g. Feb 28/29, Apr 30)
    const lastDay = getUTCDaysInMonth(year, month);
    const actualDay = Math.min(dayOfMonth, lastDay);

    const instanceDate = new Date(Date.UTC(
      year, month, actualDay,
      start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds(),
    ));

    if (instanceDate > recurrenceEnd) break;

    // Only emit on or after the original start date
    if (instanceDate >= start) {
      instances.push(makeInstance(instanceDate, durationMs, hasEnd, instances.length));
    }

    // Move to next month
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }

  return instances;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function makeInstance(
  date: Date,
  durationMs: number,
  hasEnd: boolean,
  index: number,
): EventInstanceDate {
  return {
    start_date: date.toISOString(),
    end_date: hasEnd ? new Date(date.getTime() + durationMs).toISOString() : null,
    recurrence_index: index,
  };
}

function setUTCTimeFrom(target: Date, source: Date): Date {
  const d = new Date(target);
  d.setUTCHours(source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds());
  return d;
}

function endOfDayUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function addMonthsUTC(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function getUTCDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
