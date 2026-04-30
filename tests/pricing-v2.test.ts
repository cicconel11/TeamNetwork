import { describe, it } from "node:test";
import assert from "node:assert";

import {
  quote,
  SALES_LED_ALUMNI_THRESHOLD,
  isSelfServeSalesLed,
  SELF_SERVE_ALUMNI_LIMIT,
  SELF_SERVE_SUB_ORG_LIMIT,
} from "@/lib/pricing-v2";

describe("pricing-v2 quote() — pinned scenarios", () => {
  it("single org: 200 actives + 1,200 alumni → $320/mo, $3,187.20/yr", () => {
    const q = quote({ tier: "single", actives: 200, alumni: 1_200 });
    assert.strictEqual(q.salesLed, false);
    assert.strictEqual(q.monthlyCents, 32_000);
    assert.strictEqual(q.yearlyCents, 318_720);
    assert.deepStrictEqual(q.breakdown, {
      alumniRateCents: 25,
      alumniMonthlyCents: 30_000,
      activeRateCents: 10,
      activeMonthlyCents: 2_000,
      platformBaseCents: 0,
      subOrgsBilled: 0,
      subOrgMonthlyCents: 0,
    });
  });

  it("enterprise: 15 sub-orgs + 1,000 actives + 20,000 alumni → $3,175/mo, $31,623/yr", () => {
    const q = quote({ tier: "enterprise", actives: 1_000, alumni: 20_000, subOrgs: 15 });
    assert.strictEqual(q.salesLed, false);
    assert.strictEqual(q.monthlyCents, 317_500);
    assert.strictEqual(q.yearlyCents, 3_162_300);
    assert.deepStrictEqual(q.breakdown, {
      alumniRateCents: 13,
      alumniMonthlyCents: 260_000,
      activeRateCents: 5,
      activeMonthlyCents: 5_000,
      platformBaseCents: 25_000,
      subOrgsBilled: 15,
      subOrgMonthlyCents: 27_500,
    });
  });
});

describe("pricing-v2 quote() — edges", () => {
  it("zero inputs → 0/0", () => {
    const q = quote({ tier: "single", actives: 0, alumni: 0 });
    assert.strictEqual(q.monthlyCents, 0);
    assert.strictEqual(q.yearlyCents, 0);
    assert.strictEqual(q.salesLed, false);
    assert.strictEqual(q.breakdown.alumniRateCents, 0);
    assert.strictEqual(q.breakdown.activeRateCents, 0);
  });

  it("alumni 500 vs 501 slab cliff", () => {
    const a = quote({ tier: "single", actives: 0, alumni: 500 });
    assert.strictEqual(a.monthlyCents, 18_000); // 500 × 36
    const b = quote({ tier: "single", actives: 0, alumni: 501 });
    assert.strictEqual(b.monthlyCents, 12_525); // 501 × 25
  });

  it("active 100 vs 101 slab cliff", () => {
    const a = quote({ tier: "single", actives: 100, alumni: 0 });
    assert.strictEqual(a.monthlyCents, 1_500);
    const b = quote({ tier: "single", actives: 101, alumni: 0 });
    assert.strictEqual(b.monthlyCents, 1_010);
  });

  it("sub-org 10 vs 11 (enterprise, 0 users)", () => {
    const a = quote({ tier: "enterprise", actives: 0, alumni: 0, subOrgs: 10 });
    assert.strictEqual(a.monthlyCents, 45_000); // 25k base + 10 × 2k
    const b = quote({ tier: "enterprise", actives: 0, alumni: 0, subOrgs: 11 });
    assert.strictEqual(b.monthlyCents, 46_500); // 25k + 10 × 2k + 1 × 1.5k
  });

  it("alumni > 100,000 → salesLed", () => {
    const q = quote({ tier: "enterprise", actives: 1_000, alumni: 100_001, subOrgs: 5 });
    assert.strictEqual(q.salesLed, true);
    assert.strictEqual(q.monthlyCents, 0);
    assert.strictEqual(q.yearlyCents, 0);
  });

  it("alumni == threshold not salesLed", () => {
    const q = quote({ tier: "single", actives: 0, alumni: SALES_LED_ALUMNI_THRESHOLD });
    assert.strictEqual(q.salesLed, false);
  });

  it("single tier ignores subOrgs", () => {
    const q = quote({ tier: "single", actives: 0, alumni: 0, subOrgs: 50 });
    assert.strictEqual(q.monthlyCents, 0);
    assert.strictEqual(q.breakdown.subOrgMonthlyCents, 0);
    assert.strictEqual(q.breakdown.subOrgsBilled, 0);
  });
});

describe("pricing-v2 isSelfServeSalesLed()", () => {
  it("single tier at limit not sales-led", () => {
    assert.strictEqual(
      isSelfServeSalesLed({ tier: "single", actives: 100, alumni: SELF_SERVE_ALUMNI_LIMIT }),
      false,
    );
  });

  it("single tier above limit sales-led", () => {
    assert.strictEqual(
      isSelfServeSalesLed({ tier: "single", actives: 100, alumni: SELF_SERVE_ALUMNI_LIMIT + 1 }),
      true,
    );
  });

  it("enterprise tier at sub-org cap not sales-led", () => {
    assert.strictEqual(
      isSelfServeSalesLed({
        tier: "enterprise",
        actives: 100,
        alumni: 1_000,
        subOrgs: SELF_SERVE_SUB_ORG_LIMIT,
      }),
      false,
    );
  });

  it("enterprise tier above sub-org cap sales-led", () => {
    assert.strictEqual(
      isSelfServeSalesLed({
        tier: "enterprise",
        actives: 100,
        alumni: 1_000,
        subOrgs: SELF_SERVE_SUB_ORG_LIMIT + 1,
      }),
      true,
    );
  });

  it("enterprise alumni overflow trumps small sub-org count", () => {
    assert.strictEqual(
      isSelfServeSalesLed({
        tier: "enterprise",
        actives: 0,
        alumni: SELF_SERVE_ALUMNI_LIMIT + 1,
        subOrgs: 0,
      }),
      true,
    );
  });

  it("single tier ignores subOrgs for sales-led check", () => {
    assert.strictEqual(
      isSelfServeSalesLed({
        tier: "single",
        actives: 0,
        alumni: 0,
        subOrgs: SELF_SERVE_SUB_ORG_LIMIT + 100,
      }),
      false,
    );
  });
});
