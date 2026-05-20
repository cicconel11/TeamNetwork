const TRACKED_STATUSES = [
  "hit_exact",
  "miss",
  "bypass",
  "ineligible",
  "disabled",
  "error",
] as const;

type TrackedStatus = (typeof TRACKED_STATUSES)[number];

export interface ViewRow {
  day: string;
  cache_status: string;
  count: number | string;
  pct_of_day: number | string | null;
}

interface DaySummary {
  day: string;
  total: number;
  byStatus: Record<TrackedStatus | "unset" | "other", number>;
}

export interface CacheStatsResponse {
  windowDays: number;
  totalRequests: number;
  overallHitRate: number;
  byStatus: Record<TrackedStatus | "unset" | "other", number>;
  byDay: DaySummary[];
}

function emptyStatusMap(): Record<TrackedStatus | "unset" | "other", number> {
  return {
    hit_exact: 0,
    miss: 0,
    bypass: 0,
    ineligible: 0,
    disabled: 0,
    error: 0,
    unset: 0,
    other: 0,
  };
}

function classify(status: string): TrackedStatus | "unset" | "other" {
  if (status === "unset") return "unset";
  if ((TRACKED_STATUSES as readonly string[]).includes(status)) {
    return status as TrackedStatus;
  }
  return "other";
}

export function buildResponse(rows: ViewRow[], windowDays: number): CacheStatsResponse {
  const overall = emptyStatusMap();
  const dayMap = new Map<string, DaySummary>();

  for (const row of rows) {
    const count = typeof row.count === "string" ? Number(row.count) : row.count;
    if (!Number.isFinite(count) || count <= 0) continue;

    const bucket = classify(row.cache_status);
    overall[bucket] += count;

    const dayKey = new Date(row.day).toISOString();
    let day = dayMap.get(dayKey);
    if (!day) {
      day = { day: dayKey, total: 0, byStatus: emptyStatusMap() };
      dayMap.set(dayKey, day);
    }
    day.total += count;
    day.byStatus[bucket] += count;
  }

  const totalRequests = Object.values(overall).reduce((acc, n) => acc + n, 0);
  const overallHitRate =
    totalRequests > 0 ? Number((overall.hit_exact / totalRequests).toFixed(4)) : 0;

  const byDay = Array.from(dayMap.values()).sort((a, b) =>
    a.day < b.day ? 1 : a.day > b.day ? -1 : 0
  );

  return { windowDays, totalRequests, overallHitRate, byStatus: overall, byDay };
}
