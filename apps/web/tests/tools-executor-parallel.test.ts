/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  executeToolCalls,
  type ToolExecutionContext,
} from "../src/lib/ai/tools/executor.ts";
import type { ToolExecutionResult } from "../src/lib/ai/tools/result.ts";

const fakeCtx = {} as ToolExecutionContext;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("executeToolCalls (parallel batch)", () => {
  it("returns results in input order regardless of completion order", async () => {
    const calls = [
      { name: "a", args: { latency: 30 } },
      { name: "b", args: { latency: 5 } },
      { name: "c", args: { latency: 15 } },
    ];

    const results = await executeToolCalls(fakeCtx, calls, {
      maxInflight: 3,
      executeFn: async (_ctx, call) => {
        await delay((call.args as { latency: number }).latency);
        return { kind: "ok", data: { name: call.name } };
      },
    });

    assert.equal(results.length, 3);
    assert.deepEqual(results[0], { kind: "ok", data: { name: "a" } });
    assert.deepEqual(results[1], { kind: "ok", data: { name: "b" } });
    assert.deepEqual(results[2], { kind: "ok", data: { name: "c" } });
  });

  it("middle call throw -> tool_error row, siblings unaffected", async () => {
    const calls = [
      { name: "a", args: {} },
      { name: "b", args: {} },
      { name: "c", args: {} },
    ];

    const results = await executeToolCalls(fakeCtx, calls, {
      maxInflight: 3,
      executeFn: async (_ctx, call) => {
        if (call.name === "b") throw new Error("boom");
        return { kind: "ok", data: { name: call.name } };
      },
    });

    assert.equal(results[0].kind, "ok");
    assert.equal(results[1].kind, "tool_error");
    assert.equal((results[1] as Extract<ToolExecutionResult, { kind: "tool_error" }>).error, "boom");
    assert.equal(results[2].kind, "ok");
  });

  it("timeout shape preserved when executeFn returns a timeout result", async () => {
    const calls = [
      { name: "a", args: {} },
      { name: "slow", args: {} },
    ];

    const results = await executeToolCalls(fakeCtx, calls, {
      maxInflight: 2,
      executeFn: async (_ctx, call) => {
        if (call.name === "slow") {
          return { kind: "timeout", error: "Tool timed out" };
        }
        return { kind: "ok", data: null };
      },
    });

    assert.equal(results[0].kind, "ok");
    assert.equal(results[1].kind, "timeout");
  });

  it("respects maxInflight cap (10 calls, cap 4 -> max 4 concurrent)", async () => {
    let active = 0;
    let peak = 0;

    const calls = Array.from({ length: 10 }, (_, i) => ({
      name: `t${i}`,
      args: {},
    }));

    const results = await executeToolCalls(fakeCtx, calls, {
      maxInflight: 4,
      executeFn: async (_ctx, call) => {
        active++;
        peak = Math.max(peak, active);
        await delay(10);
        active--;
        return { kind: "ok", data: { name: call.name } };
      },
    });

    assert.equal(results.length, 10);
    assert.ok(peak <= 4, `peak concurrency ${peak} exceeded cap 4`);
    assert.ok(peak >= 2, `peak concurrency ${peak} suspiciously low; pool may not be running in parallel`);
  });

  it("empty input -> empty output", async () => {
    const results = await executeToolCalls(fakeCtx, [], {
      maxInflight: 4,
      executeFn: async () => ({ kind: "ok", data: null }),
    });
    assert.deepEqual(results, []);
  });

  it("maxInflight clamped to >= 1", async () => {
    const calls = [
      { name: "a", args: {} },
      { name: "b", args: {} },
    ];
    const results = await executeToolCalls(fakeCtx, calls, {
      maxInflight: 0,
      executeFn: async (_ctx, call) => ({ kind: "ok", data: { name: call.name } }),
    });
    assert.equal(results.length, 2);
    assert.equal(results[0].kind, "ok");
    assert.equal(results[1].kind, "ok");
  });

  it("invalid maxInflight values default to one worker", async () => {
    const calls = [
      { name: "a", args: {} },
      { name: "b", args: {} },
    ];

    for (const maxInflight of [Number.NaN, Number.POSITIVE_INFINITY]) {
      let active = 0;
      let peak = 0;
      const results = await executeToolCalls(fakeCtx, calls, {
        maxInflight,
        executeFn: async (_ctx, call) => {
          active++;
          peak = Math.max(peak, active);
          await delay(1);
          active--;
          return { kind: "ok", data: { name: call.name } };
        },
      });

      assert.equal(results.length, 2);
      assert.equal(results[0].kind, "ok");
      assert.equal(results[1].kind, "ok");
      assert.equal(peak, 1);
    }
  });
});
