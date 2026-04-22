import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AI_RECENT_ENTITY_LOOKBACK_EDIT_MS,
  AI_RECENT_ENTITY_LOOKBACK_DELETE_MS,
  resolveAgentActionTarget,
  type ResolverSupabaseClient,
} from "@/lib/ai/tools/target-resolver";

type RecordedCall =
  | { op: "from"; table: string }
  | { op: "select"; columns: string }
  | { op: "eq"; column: string; value: unknown }
  | { op: "gte"; column: string; value: unknown }
  | { op: "order"; column: string; options: { ascending: boolean } }
  | { op: "limit"; n: number };

function stubSupabase(
  rows: Array<{ result_entity_id: string }>,
  calls: RecordedCall[] = []
): { client: ResolverSupabaseClient; calls: RecordedCall[] } {
  const chain: {
    eq: (column: string, value: unknown) => typeof chain;
    gte: (column: string, value: unknown) => typeof chain;
    order: (column: string, options: { ascending: boolean }) => typeof chain;
    limit: (n: number) => typeof chain;
    then: <R>(
      onFulfilled: (v: { data: typeof rows; error: null }) => R
    ) => Promise<R>;
  } = {
    eq(column, value) {
      calls.push({ op: "eq", column, value });
      return chain;
    },
    gte(column, value) {
      calls.push({ op: "gte", column, value });
      return chain;
    },
    order(column, options) {
      calls.push({ op: "order", column, options });
      return chain;
    },
    limit(n) {
      calls.push({ op: "limit", n });
      return chain;
    },
    then(onFulfilled) {
      return Promise.resolve(onFulfilled({ data: rows, error: null }));
    },
  };

  const client = {
    from(table: string) {
      calls.push({ op: "from", table });
      return {
        select(columns: string) {
          calls.push({ op: "select", columns });
          return chain;
        },
      };
    },
  } as unknown as ResolverSupabaseClient;

  return { client, calls };
}

describe("resolveAgentActionTarget — explicit target_id short-circuit", () => {
  it("returns resolved immediately without touching supabase", async () => {
    const { client, calls } = stubSupabase([]);
    const result = await resolveAgentActionTarget({
      supabase: client,
      caller: { userId: "u1", organizationId: "o1" },
      entityType: "announcement",
      op: "edit",
      targetId: "00000000-0000-0000-0000-0000000000aa",
      fallback: "most_recent",
    });

    assert.equal(result.kind, "resolved");
    if (result.kind === "resolved") {
      assert.equal(result.targetId, "00000000-0000-0000-0000-0000000000aa");
      assert.equal(result.entityType, "announcement");
    }
    assert.equal(calls.length, 0);
  });

  it("short-circuits even for delete ops (explicit id always wins)", async () => {
    const { client, calls } = stubSupabase([]);
    const result = await resolveAgentActionTarget({
      supabase: client,
      caller: { userId: "u1", organizationId: "o1" },
      entityType: "event",
      op: "cancel",
      targetId: "00000000-0000-0000-0000-0000000000bb",
      fallback: "most_recent",
    });
    assert.equal(result.kind, "resolved");
    assert.equal(calls.length, 0);
  });
});

describe("resolveAgentActionTarget — most-recent fallback for edit", () => {
  it("queries ai_pending_actions with scoping, window, and tiebreaker", async () => {
    const { client, calls } = stubSupabase([
      { result_entity_id: "00000000-0000-0000-0000-0000000000c1" },
    ]);
    const before = Date.now();
    const result = await resolveAgentActionTarget({
      supabase: client,
      caller: { userId: "u1", organizationId: "o1" },
      entityType: "announcement",
      op: "edit",
      fallback: "most_recent",
    });
    const after = Date.now();

    assert.equal(result.kind, "resolved");
    if (result.kind === "resolved") {
      assert.equal(result.targetId, "00000000-0000-0000-0000-0000000000c1");
    }

    assert.deepEqual(calls[0], { op: "from", table: "ai_pending_actions" });
    assert.deepEqual(calls[1], { op: "select", columns: "result_entity_id" });

    const eqCalls = calls.filter((c) => c.op === "eq");
    assert.deepEqual(
      eqCalls.map((c) => (c.op === "eq" ? [c.column, c.value] : [])),
      [
        ["user_id", "u1"],
        ["organization_id", "o1"],
        ["result_entity_type", "announcement"],
        ["status", "executed"],
      ]
    );

    const gte = calls.find((c) => c.op === "gte");
    assert.ok(gte && gte.op === "gte", "gte cutoff call must exist");
    if (gte.op === "gte") {
      assert.equal(gte.column, "executed_at");
      const cutoffMs = Date.parse(gte.value as string);
      const expectedLow = before - AI_RECENT_ENTITY_LOOKBACK_EDIT_MS;
      const expectedHigh = after - AI_RECENT_ENTITY_LOOKBACK_EDIT_MS;
      assert.ok(
        cutoffMs >= expectedLow && cutoffMs <= expectedHigh,
        `cutoff ${new Date(cutoffMs).toISOString()} outside window [${new Date(expectedLow).toISOString()}, ${new Date(expectedHigh).toISOString()}]`
      );
    }

    const orderCalls = calls.filter((c) => c.op === "order");
    assert.equal(orderCalls.length, 2, "must sort by executed_at DESC then id DESC");
    if (orderCalls[0].op === "order") {
      assert.equal(orderCalls[0].column, "executed_at");
      assert.equal(orderCalls[0].options.ascending, false);
    }
    if (orderCalls[1].op === "order") {
      assert.equal(orderCalls[1].column, "id");
      assert.equal(orderCalls[1].options.ascending, false);
    }

    const limit = calls.find((c) => c.op === "limit");
    if (limit && limit.op === "limit") {
      assert.equal(limit.n, 1);
    }
  });

  it("returns not_found when no recent executed row exists", async () => {
    const { client } = stubSupabase([]);
    const result = await resolveAgentActionTarget({
      supabase: client,
      caller: { userId: "u1", organizationId: "o1" },
      entityType: "announcement",
      op: "edit",
      fallback: "most_recent",
    });
    assert.equal(result.kind, "not_found");
  });
});

describe("resolveAgentActionTarget — most-recent fallback disabled for destructive ops", () => {
  for (const op of ["delete", "cancel"] as const) {
    it(`refuses most-recent fallback for ${op} ops`, async () => {
      const { client, calls } = stubSupabase([
        { result_entity_id: "00000000-0000-0000-0000-0000000000d1" },
      ]);
      const result = await resolveAgentActionTarget({
        supabase: client,
        caller: { userId: "u1", organizationId: "o1" },
        entityType: "announcement",
        op,
        fallback: "most_recent",
      });
      assert.equal(result.kind, "needs_target_id");
      assert.equal(
        calls.length,
        0,
        `resolver must not query supabase for ${op} without explicit target_id`
      );
    });
  }
});

describe("resolveAgentActionTarget — fallback: 'none'", () => {
  it("returns needs_target_id without querying supabase", async () => {
    const { client, calls } = stubSupabase([
      { result_entity_id: "00000000-0000-0000-0000-0000000000e1" },
    ]);
    const result = await resolveAgentActionTarget({
      supabase: client,
      caller: { userId: "u1", organizationId: "o1" },
      entityType: "job",
      op: "edit",
      fallback: "none",
    });
    assert.equal(result.kind, "needs_target_id");
    assert.equal(calls.length, 0);
  });
});

describe("resolveAgentActionTarget — windowMs override", () => {
  it("respects a caller-supplied windowMs that narrows the window", async () => {
    const { client, calls } = stubSupabase([
      { result_entity_id: "00000000-0000-0000-0000-0000000000f1" },
    ]);
    const customWindow = 60_000;
    const before = Date.now();
    await resolveAgentActionTarget({
      supabase: client,
      caller: { userId: "u1", organizationId: "o1" },
      entityType: "announcement",
      op: "edit",
      fallback: "most_recent",
      windowMs: customWindow,
    });
    const after = Date.now();

    const gte = calls.find((c) => c.op === "gte");
    assert.ok(gte && gte.op === "gte");
    if (gte.op === "gte") {
      const cutoffMs = Date.parse(gte.value as string);
      assert.ok(
        cutoffMs >= before - customWindow && cutoffMs <= after - customWindow,
        "cutoff must honor windowMs override"
      );
    }
  });

  it("windowMs=0 disables the fallback even for edit ops", async () => {
    const { client, calls } = stubSupabase([
      { result_entity_id: "00000000-0000-0000-0000-0000000000f2" },
    ]);
    const result = await resolveAgentActionTarget({
      supabase: client,
      caller: { userId: "u1", organizationId: "o1" },
      entityType: "announcement",
      op: "edit",
      fallback: "most_recent",
      windowMs: 0,
    });
    assert.equal(result.kind, "needs_target_id");
    assert.equal(calls.length, 0);
  });
});

describe("Window constants", () => {
  it("edit lookback window is 15 minutes", () => {
    assert.equal(AI_RECENT_ENTITY_LOOKBACK_EDIT_MS, 15 * 60 * 1000);
  });
  it("delete lookback window is 0 (fallback disabled)", () => {
    assert.equal(AI_RECENT_ENTITY_LOOKBACK_DELETE_MS, 0);
  });
});

describe("DomainResult discriminated union", () => {
  it("accepts the ok variant with a typed value", async () => {
    const { DomainResult: _type } = await import("@/lib/ai/shared/domain-result");
    // Runtime check mirrors the type contract
    const ok: import("@/lib/ai/shared/domain-result").DomainResult<number> = {
      ok: true,
      value: 42,
    };
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.value, 42);
    void _type;
  });

  it("accepts the error variant with a finite status", () => {
    const err: import("@/lib/ai/shared/domain-result").DomainResult<number> = {
      ok: false,
      status: 422,
      error: "invariant_violation",
      details: { field: "title" },
    };
    assert.equal(err.ok, false);
    if (!err.ok) {
      assert.equal(err.status, 422);
      assert.equal(err.error, "invariant_violation");
    }
  });
});
