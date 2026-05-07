import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getDonationAnalyticsModule } from "../src/lib/ai/tools/registry/get-donation-analytics.ts";
import { verifyToolBackedResponse } from "../src/lib/ai/grounding/tool/verifier.ts";

const ORG_ID = "org-1";
const USER_ID = "user-1";

const FULL_RPC_PAYLOAD = {
  window_days: 90,
  bucket: "month",
  totals: {
    successful_donation_count: 8,
    successful_amount_cents: 45000,
    average_successful_amount_cents: 5625,
    largest_successful_amount_cents: 12500,
    status_counts: { succeeded: 8, pending: 1, failed: 0 },
    latest_successful_donation_at: "2026-03-20T12:00:00.000Z",
  },
  top_purposes: [
    { purpose: "Alumni Campaign", donation_count: 5, amount_cents: 30000 },
    { purpose: "Athletics", donation_count: 3, amount_cents: 15000 },
  ],
  trend: [
    { bucket_label: "2026-01", donation_count: 2, amount_cents: 10000 },
    { bucket_label: "2026-02", donation_count: 3, amount_cents: 15000 },
    { bucket_label: "2026-03", donation_count: 3, amount_cents: 20000 },
  ],
};

function makeStubSb() {
  return {
    rpc: async () => ({
      data: FULL_RPC_PAYLOAD,
      error: null,
    }),
  };
}

const ctx = {
  orgId: ORG_ID,
  userId: USER_ID,
  serviceSupabase: null as never,
  authorization: { kind: "preverified_admin", source: "ai_org_context" } as const,
};

const logContext = { requestId: "req-1", route: "test" } as never;

async function execute(args: Record<string, unknown>) {
  const parsed = getDonationAnalyticsModule.argsSchema.parse(args);
  const result = await getDonationAnalyticsModule.execute(parsed as never, {
    ctx: ctx as never,
    sb: makeStubSb() as never,
    logContext,
  });
  return result;
}

describe("get_donation_analytics — dimension arg", () => {
  it("returns full payload when dimension omitted", async () => {
    const result = await execute({});
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as Record<string, unknown>;
    assert.ok(data.totals);
    assert.ok(Array.isArray(data.top_purposes));
    assert.ok(Array.isArray(data.trend));
  });

  it("dimension=all is equivalent to omitted", async () => {
    const result = await execute({ dimension: "all" });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as Record<string, unknown>;
    assert.ok(data.totals);
    assert.ok(Array.isArray(data.top_purposes));
    assert.ok(Array.isArray(data.trend));
  });

  it("dimension=trend returns only trend rows", async () => {
    const result = await execute({ dimension: "trend" });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as Record<string, unknown>;
    assert.equal(data.totals, undefined);
    assert.equal(data.top_purposes, undefined);
    assert.ok(Array.isArray(data.trend));
    assert.equal((data.trend as unknown[]).length, 3);
    assert.equal(data.window_days, 90);
  });

  it("dimension=top_purposes returns only top_purposes", async () => {
    const result = await execute({ dimension: "top_purposes" });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as Record<string, unknown>;
    assert.equal(data.totals, undefined);
    assert.equal(data.trend, undefined);
    assert.ok(Array.isArray(data.top_purposes));
    assert.equal((data.top_purposes as unknown[]).length, 2);
  });

  it("dimension=totals returns totals without status_counts", async () => {
    const result = await execute({ dimension: "totals" });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as Record<string, unknown>;
    assert.equal(data.trend, undefined);
    assert.equal(data.top_purposes, undefined);
    const totals = data.totals as Record<string, unknown>;
    assert.equal(totals.successful_donation_count, 8);
    assert.equal(totals.status_counts, undefined);
  });

  it("dimension=status_mix returns only status_counts", async () => {
    const result = await execute({ dimension: "status_mix" });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as Record<string, unknown>;
    assert.equal(data.trend, undefined);
    assert.equal(data.top_purposes, undefined);
    const totals = data.totals as Record<string, unknown>;
    assert.deepEqual(totals.status_counts, { succeeded: 8, pending: 1, failed: 0 });
    assert.equal(totals.successful_donation_count, undefined);
  });

  it("rejects invalid dimension at the boundary", () => {
    assert.throws(() =>
      getDonationAnalyticsModule.argsSchema.parse({ dimension: "garbage" })
    );
  });

  it("rejects unknown args (strict)", () => {
    assert.throws(() =>
      getDonationAnalyticsModule.argsSchema.parse({ dimension: "trend", extra: 1 })
    );
  });
});

describe("get_donation_analytics — grounding tolerance", () => {
  it("verifier accepts trend-only payload + trend-only answer", () => {
    const result = verifyToolBackedResponse({
      content: "Donation analytics (90-day window)\nTrend\n- 2026-03 - 3 donations - $200",
      toolResults: [
        {
          name: "get_donation_analytics",
          data: {
            window_days: 90,
            trend: [
              { bucket_label: "2026-03", donation_count: 3, amount_cents: 20000 },
            ],
          },
        },
      ],
    });
    assert.equal(result.grounded, true, result.failures.join("; "));
  });

  it("verifier accepts top_purposes-only payload", () => {
    const result = verifyToolBackedResponse({
      content:
        "Donation analytics\nTop purposes\n- Alumni Campaign - 5 donations - $300",
      toolResults: [
        {
          name: "get_donation_analytics",
          data: {
            window_days: 90,
            top_purposes: [
              { purpose: "Alumni Campaign", donation_count: 5, amount_cents: 30000 },
            ],
          },
        },
      ],
    });
    assert.equal(result.grounded, true, result.failures.join("; "));
  });

  it("verifier still flags wrong claim on full payload", () => {
    const result = verifyToolBackedResponse({
      content:
        "Donation analytics (90-day window)\n- Successful donations: 99\n- Raised: $450",
      toolResults: [{ name: "get_donation_analytics", data: FULL_RPC_PAYLOAD }],
    });
    assert.equal(result.grounded, false);
    assert.match(
      result.failures.join("\n"),
      /successful donations claim 99 did not match 8/i
    );
  });
});
