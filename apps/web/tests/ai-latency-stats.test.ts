import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLatencyStats,
  type AiLatencyAuditRow,
} from "../src/lib/ai/latency-stats.ts";

function row(overrides: Partial<AiLatencyAuditRow> = {}): AiLatencyAuditRow {
  return {
    created_at: "2026-05-01T12:00:00Z",
    latency_ms: 100,
    cache_status: "miss",
    context_surface: "general",
    intent_type: "knowledge_query",
    stage_timings: {
      schema_version: 1,
      request: {
        pass1_path: "model",
        fast_path_label: "model_default",
        time_to_first_event_ms: 25,
      },
      stages: {
        pass1_model: { status: "completed", duration_ms: 40 },
        tools: {
          status: "completed",
          duration_ms: 30,
          calls: [
            {
              name: "list_members",
              status: "completed",
              duration_ms: 30,
              auth_mode: "db_lookup",
            },
          ],
        },
      },
    },
    ...overrides,
  };
}

test("buildLatencyStats: empty rows return aggregate-only empty buckets", () => {
  const out = buildLatencyStats([]);
  assert.deepEqual(out.byPass1Path, {});
  assert.deepEqual(out.byFastPathLabel, {});
  assert.deepEqual(out.byCacheStatus, {});
  assert.equal(out.timeToFirstEvent.n, 0);
  assert.equal(out.unclassifiedCount, 0);
  assert.equal(out.truncated, false);
  assert.equal(out.windowStart, null);
});

test("buildLatencyStats: malformed and missing stage_timings bucket as unclassified", () => {
  const out = buildLatencyStats([
    row({ latency_ms: "50", stage_timings: "{nope" }),
    row({ latency_ms: 75, stage_timings: null }),
  ]);

  assert.equal(out.byPass1Path.unclassified.n, 2);
  assert.equal(out.byFastPathLabel.unclassified.n, 2);
  assert.equal(out.byCacheStatus.miss.n, 2);
  assert.equal(out.unclassifiedCount, 2);
});

test("buildLatencyStats: old rows without fast_path_label remain valid", () => {
  const out = buildLatencyStats([
    row({
      stage_timings: {
        request: { pass1_path: "bypass_zero_arg" },
        stages: {},
      },
    }),
  ]);

  assert.equal(out.byPass1Path.bypass_zero_arg.n, 1);
  assert.equal(out.byFastPathLabel.unclassified.n, 1);
  assert.equal(out.unclassifiedCount, 1);
});

test("buildLatencyStats: numeric strings, truncation, and windowStart are handled", () => {
  const out = buildLatencyStats(
    [
      row({ created_at: "2026-05-01T12:00:00Z", latency_ms: "120" }),
      row({ created_at: "2026-04-29T08:00:00Z", latency_ms: 80 }),
    ],
    { truncated: true },
  );

  assert.equal(out.byPass1Path.model.n, 2);
  assert.equal(out.byPass1Path.model.avg_ms, 100);
  assert.equal(out.truncated, true);
  assert.equal(out.windowStart, "2026-04-29T08:00:00.000Z");
});

test("buildLatencyStats: p95 is suppressed until a bucket has at least 20 samples", () => {
  const small = buildLatencyStats(Array.from({ length: 19 }, (_, index) => row({ latency_ms: index + 1 })));
  assert.equal(small.byPass1Path.model.n, 19);
  assert.equal(small.byPass1Path.model.p95_ms, null);
  assert.equal(small.byPass1Path.model.p95_reliable, false);

  const large = buildLatencyStats(Array.from({ length: 20 }, (_, index) => row({ latency_ms: index + 1 })));
  assert.equal(large.byPass1Path.model.n, 20);
  assert.equal(large.byPass1Path.model.p95_ms, 19);
  assert.equal(large.byPass1Path.model.p95_reliable, true);
});

test("buildLatencyStats: groups tool latency as top 20 plus other", () => {
  const rows = Array.from({ length: 21 }, (_, index) =>
    row({
      stage_timings: {
        request: { pass1_path: "model", fast_path_label: "model_default" },
        stages: {
          tools: {
            status: "completed",
            duration_ms: index + 1,
            calls: [{ name: `tool_${index}`, duration_ms: index + 1 }],
          },
        },
      },
    }),
  );

  const out = buildLatencyStats(rows);
  assert.equal(Object.keys(out.toolLatency).length, 21);
  assert.equal(out.toolLatency.other.n, 1);
});

test("buildLatencyStats: bottlenecks rank slow stages and tools", () => {
  const out = buildLatencyStats([
    row({
      stage_timings: {
        request: { pass1_path: "model", fast_path_label: "model_default" },
        stages: {
          pass1_model: { status: "completed", duration_ms: 300 },
          pass2: { status: "completed", duration_ms: 100 },
          tools: {
            status: "completed",
            duration_ms: 50,
            calls: [{ name: "list_members", duration_ms: 50 }],
          },
        },
      },
    }),
  ]);

  assert.equal(out.bottlenecks[0]?.kind, "stage");
  assert.equal(out.bottlenecks[0]?.name, "pass1_model");
});

test("buildLatencyStats: ignores a top-level pass1_path footgun column", () => {
  const out = buildLatencyStats([
    {
      ...row({
        stage_timings: { request: { fast_path_label: "model_default" }, stages: {} },
      }),
      pass1_path: "bypass_derived",
    } as AiLatencyAuditRow & { pass1_path: string },
  ]);

  assert.equal(out.byPass1Path.unclassified.n, 1);
  assert.equal(out.byPass1Path.bypass_derived, undefined);
});
