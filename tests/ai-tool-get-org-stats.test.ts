import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getOrgStatsModule } from "../src/lib/ai/tools/registry/get-org-stats.ts";
import { verifyToolBackedResponse } from "../src/lib/ai/grounding/tool/verifier.ts";

const ORG_ID = "org-1";
const USER_ID = "user-1";

interface CallRecord {
  table: string;
  filters: Record<string, unknown>;
  head: boolean;
}

const COUNTS: Record<string, number> = {
  members: 35,
  alumni: 12,
  parents: 4,
  events: 3,
};

const DONATIONS_ROW = {
  total_amount_cents: 420000,
  donation_count: 18,
  last_donation_at: "2026-03-24T00:00:00.000Z",
};

function makeStubSb() {
  const calls: CallRecord[] = [];

  function builder(table: string) {
    const record: CallRecord = { table, filters: {}, head: false };
    const chain = {
      select(_cols: string, opts?: { head?: boolean }) {
        record.head = Boolean(opts?.head);
        return chain;
      },
      eq(col: string, val: unknown) {
        record.filters[col] = val;
        return chain;
      },
      is(col: string, val: unknown) {
        record.filters[`${col}__is`] = val;
        return chain;
      },
      gte(col: string, val: unknown) {
        record.filters[`${col}__gte`] = val;
        return chain;
      },
      maybeSingle() {
        return Promise.resolve({ data: DONATIONS_ROW, error: null });
      },
      then(resolve: (value: { count: number; error: null }) => void) {
        // For count/head queries — supabase awaits the chain.
        calls.push(record);
        const count = COUNTS[table] ?? 0;
        resolve({ count, error: null });
      },
    };
    return chain;
  }

  return {
    sb: { from: builder },
    calls,
  };
}

const ctx = {
  orgId: ORG_ID,
  userId: USER_ID,
  serviceSupabase: null as never,
  authorization: { kind: "preverified_admin", source: "ai_org_context" } as const,
};

const logContext = { requestId: "req-1", route: "test" } as never;

async function execute(args: { scope?: string }) {
  const stub = makeStubSb();
  const parsed = getOrgStatsModule.argsSchema.parse(args);
  const result = await getOrgStatsModule.execute(parsed as never, {
    ctx: ctx as never,
    sb: stub.sb,
    logContext,
  });
  return { result, calls: stub.calls };
}

describe("get_org_stats — scope arg", () => {
  it("returns full payload when scope omitted", async () => {
    const { result, calls } = await execute({});
    assert.equal(result.kind, "ok");
    assert.deepEqual(result.kind === "ok" ? result.data : null, {
      active_members: 35,
      alumni: 12,
      parents: 4,
      upcoming_events: 3,
      donations: DONATIONS_ROW,
    });
    assert.equal(calls.length, 4); // 4 count queries; donation uses maybeSingle (no record)
  });

  it("scope=all is equivalent to omitted", async () => {
    const { result } = await execute({ scope: "all" });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as Record<string, unknown>;
    assert.equal(data.active_members, 35);
    assert.equal(data.alumni, 12);
    assert.equal(data.parents, 4);
    assert.equal(data.upcoming_events, 3);
    assert.deepEqual(data.donations, DONATIONS_ROW);
  });

  it("scope=members returns only active_members", async () => {
    const { result, calls } = await execute({ scope: "members" });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.deepEqual(result.data, { active_members: 35 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].table, "members");
  });

  it("scope=alumni returns only alumni", async () => {
    const { result, calls } = await execute({ scope: "alumni" });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.deepEqual(result.data, { alumni: 12 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].table, "alumni");
  });

  it("scope=parents returns only parents", async () => {
    const { result } = await execute({ scope: "parents" });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.deepEqual(result.data, { parents: 4 });
  });

  it("scope=events returns only upcoming_events", async () => {
    const { result } = await execute({ scope: "events" });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.deepEqual(result.data, { upcoming_events: 3 });
  });

  it("scope=donations returns only donations", async () => {
    const { result } = await execute({ scope: "donations" });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.deepEqual(result.data, { donations: DONATIONS_ROW });
  });

  it("rejects invalid scope at the boundary", () => {
    assert.throws(() => getOrgStatsModule.argsSchema.parse({ scope: "garbage" }));
  });

  it("rejects unknown args (strict)", () => {
    assert.throws(() => getOrgStatsModule.argsSchema.parse({ scope: "members", extra: 1 }));
  });
});

describe("get_org_stats — grounding tolerance", () => {
  it("verifier accepts members-only payload + scoped answer", () => {
    const result = verifyToolBackedResponse({
      content: "Active members: 35.",
      toolResults: [{ name: "get_org_stats", data: { active_members: 35 } }],
    });
    assert.equal(result.grounded, true, result.failures.join("; "));
  });

  it("verifier accepts donations-only payload", () => {
    const result = verifyToolBackedResponse({
      content: "There have been 18 donations totaling $4,200 raised.",
      toolResults: [
        { name: "get_org_stats", data: { donations: DONATIONS_ROW } },
      ],
    });
    assert.equal(result.grounded, true, result.failures.join("; "));
  });

  it("verifier still flags wrong active members claim on full payload", () => {
    const result = verifyToolBackedResponse({
      content: "Your organization has 99 active members.",
      toolResults: [
        {
          name: "get_org_stats",
          data: { active_members: 35, alumni: 12, parents: 4, upcoming_events: 3, donations: null },
        },
      ],
    });
    assert.equal(result.grounded, false);
    assert.match(result.failures.join("\n"), /active members claim 99 did not match 35/i);
  });
});
