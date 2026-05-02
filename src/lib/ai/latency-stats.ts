import { AI_AUDIT_STAGE_NAMES, type AiAuditStageName } from "@/lib/ai/chat-telemetry";

export interface AiLatencyAuditRow {
  created_at: string | null;
  latency_ms: number | string | null;
  cache_status: string | null;
  context_surface: string | null;
  intent_type: string | null;
  stage_timings: unknown;
}

export interface LatencyBucket {
  n: number;
  avg_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  p95_reliable: boolean;
}

export interface BottleneckBucket extends LatencyBucket {
  kind: "stage" | "tool";
  name: string;
}

export interface AiLatencyStats {
  byPass1Path: Record<string, LatencyBucket>;
  byFastPathLabel: Record<string, LatencyBucket>;
  byCacheStatus: Record<string, LatencyBucket>;
  stageLatency: Record<string, LatencyBucket>;
  toolLatency: Record<string, LatencyBucket>;
  timeToFirstEvent: LatencyBucket;
  bottlenecks: BottleneckBucket[];
  unclassifiedCount: number;
  truncated: boolean;
  windowStart: string | null;
}

export interface BuildLatencyStatsOptions {
  truncated?: boolean;
}

export function parseLatencyStatsDays(url: string): { ok: true; days: 1 | 7 | 30 } | { ok: false } {
  const searchParams = new URL(url).searchParams;
  const values = searchParams.getAll("days");
  if (values.length > 1) return { ok: false };
  const raw = values[0] ?? "7";
  if (raw !== "1" && raw !== "7" && raw !== "30") return { ok: false };
  return { ok: true, days: Number(raw) as 1 | 7 | 30 };
}

interface StageTimingsRequest {
  pass1_path?: unknown;
  fast_path_label?: unknown;
  time_to_first_event_ms?: unknown;
}

interface ParsedStageTimings {
  request?: StageTimingsRequest;
  stages?: Record<string, unknown>;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseStageTimings(value: unknown): ParsedStageTimings | null {
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as ParsedStageTimings;
}

function stringBucket(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : "unclassified";
}

function push(map: Map<string, number[]>, key: string, value: number | null): void {
  if (value == null) return;
  const bucket = map.get(key);
  if (bucket) {
    bucket.push(value);
  } else {
    map.set(key, [value]);
  }
}

function summarize(values: number[]): LatencyBucket {
  if (values.length === 0) {
    return { n: 0, avg_ms: null, p50_ms: null, p95_ms: null, p95_reliable: false };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? null;
  };
  const avg = sorted.reduce((sum, n) => sum + n, 0) / sorted.length;
  const p95Reliable = sorted.length >= 20;

  return {
    n: sorted.length,
    avg_ms: Number(avg.toFixed(2)),
    p50_ms: percentile(50),
    p95_ms: p95Reliable ? percentile(95) : null,
    p95_reliable: p95Reliable,
  };
}

function summarizeMap(map: Map<string, number[]>): Record<string, LatencyBucket> {
  return Object.fromEntries(
    Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => [key, summarize(values)]),
  );
}

function summarizeTopTools(toolDurations: Map<string, number[]>): Record<string, LatencyBucket> {
  const sorted = Array.from(toolDurations.entries()).sort(([, a], [, b]) => b.length - a.length);
  const topNames = new Set(sorted.slice(0, 20).map(([name]) => name));
  const grouped = new Map<string, number[]>();

  for (const [name, values] of sorted) {
    const key = topNames.has(name) ? name : "other";
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(...values);
    } else {
      grouped.set(key, [...values]);
    }
  }

  return summarizeMap(grouped);
}

function durationFromStage(stage: unknown): number | null {
  if (!stage || typeof stage !== "object" || Array.isArray(stage)) return null;
  return toFiniteNumber((stage as { duration_ms?: unknown }).duration_ms);
}

function toolCallsFromStage(stage: unknown): unknown[] {
  if (!stage || typeof stage !== "object" || Array.isArray(stage)) return [];
  const calls = (stage as { calls?: unknown }).calls;
  return Array.isArray(calls) ? calls : [];
}

function buildBottlenecks(
  stageLatency: Record<string, LatencyBucket>,
  toolLatency: Record<string, LatencyBucket>,
): BottleneckBucket[] {
  const buckets: BottleneckBucket[] = [
    ...Object.entries(stageLatency).map(([name, bucket]) => ({
      ...bucket,
      kind: "stage" as const,
      name,
    })),
    ...Object.entries(toolLatency).map(([name, bucket]) => ({
      ...bucket,
      kind: "tool" as const,
      name,
    })),
  ];

  return buckets
    .filter((bucket) => bucket.n > 0 && bucket.avg_ms != null)
    .sort((a, b) => (b.avg_ms ?? 0) - (a.avg_ms ?? 0))
    .slice(0, 10);
}

export function buildLatencyStats(
  rows: AiLatencyAuditRow[],
  options: BuildLatencyStatsOptions = {},
): AiLatencyStats {
  const byPass1Path = new Map<string, number[]>();
  const byFastPathLabel = new Map<string, number[]>();
  const byCacheStatus = new Map<string, number[]>();
  const stageDurations = new Map<string, number[]>();
  const toolDurations = new Map<string, number[]>();
  const firstEventDurations: number[] = [];
  let unclassifiedCount = 0;
  let oldestScanned: string | null = null;

  for (const row of rows) {
    const latencyMs = toFiniteNumber(row.latency_ms);
    const createdAt = row.created_at ? new Date(row.created_at) : null;
    if (createdAt && Number.isFinite(createdAt.getTime())) {
      const iso = createdAt.toISOString();
      if (!oldestScanned || iso < oldestScanned) oldestScanned = iso;
    }

    const timings = parseStageTimings(row.stage_timings);
    const request = timings?.request;
    const pass1Path = stringBucket(request?.pass1_path);
    const fastPathLabel = stringBucket(request?.fast_path_label);
    if (pass1Path === "unclassified" || fastPathLabel === "unclassified") {
      unclassifiedCount += 1;
    }

    push(byPass1Path, pass1Path, latencyMs);
    push(byFastPathLabel, fastPathLabel, latencyMs);
    push(byCacheStatus, stringBucket(row.cache_status), latencyMs);

    const firstEventMs = toFiniteNumber(request?.time_to_first_event_ms);
    if (firstEventMs != null) firstEventDurations.push(firstEventMs);

    const stages = timings?.stages;
    if (stages && typeof stages === "object" && !Array.isArray(stages)) {
      for (const stageName of AI_AUDIT_STAGE_NAMES) {
        push(stageDurations, stageName, durationFromStage(stages[stageName]));
      }

      for (const call of toolCallsFromStage(stages.tools)) {
        if (!call || typeof call !== "object" || Array.isArray(call)) continue;
        const name = (call as { name?: unknown }).name;
        const duration = toFiniteNumber((call as { duration_ms?: unknown }).duration_ms);
        if (typeof name === "string" && name.trim() !== "") {
          push(toolDurations, name, duration);
        }
      }
    }
  }

  const stageLatency = summarizeMap(stageDurations);
  const toolLatency = summarizeTopTools(toolDurations);

  return {
    byPass1Path: summarizeMap(byPass1Path),
    byFastPathLabel: summarizeMap(byFastPathLabel),
    byCacheStatus: summarizeMap(byCacheStatus),
    stageLatency,
    toolLatency,
    timeToFirstEvent: summarize(firstEventDurations),
    bottlenecks: buildBottlenecks(stageLatency, toolLatency),
    unclassifiedCount,
    truncated: options.truncated === true,
    windowStart: oldestScanned,
  };
}

export type { AiAuditStageName };
