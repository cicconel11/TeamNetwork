import { describe, it } from "node:test";
import assert from "node:assert";

import {
  calcPerUserQuote,
  pickRateCents,
  isPerUserSalesLed,
  ACTIVE_TIERS_MONTHLY,
  ACTIVE_TIERS_YEARLY,
  ALUMNI_TIERS_MONTHLY,
  ALUMNI_TIERS_YEARLY,
} from "@teammeet/core/pricing/per-user";

describe("pickRateCents — active tiers monthly", () => {
  it("1 active → $0.15", () => {
    assert.strictEqual(pickRateCents(ACTIVE_TIERS_MONTHLY, 1), 15);
  });
  it("100 actives → $0.15 (top of bucket 1)", () => {
    assert.strictEqual(pickRateCents(ACTIVE_TIERS_MONTHLY, 100), 15);
  });
  it("101 actives → $0.10 (bucket 2 starts)", () => {
    assert.strictEqual(pickRateCents(ACTIVE_TIERS_MONTHLY, 101), 10);
  });
  it("500 actives → $0.10 (top of bucket 2)", () => {
    assert.strictEqual(pickRateCents(ACTIVE_TIERS_MONTHLY, 500), 10);
  });
  it("501 actives → $0.05 (bucket 3 starts)", () => {
    assert.strictEqual(pickRateCents(ACTIVE_TIERS_MONTHLY, 501), 5);
  });
  it("100,000 actives → $0.05 (no upper bound)", () => {
    assert.strictEqual(pickRateCents(ACTIVE_TIERS_MONTHLY, 100_000), 5);
  });
});

describe("pickRateCents — alumni tiers monthly", () => {
  it("1 alumni → $0.36", () => {
    assert.strictEqual(pickRateCents(ALUMNI_TIERS_MONTHLY, 1), 36);
  });
  it("500 alumni → $0.36", () => {
    assert.strictEqual(pickRateCents(ALUMNI_TIERS_MONTHLY, 500), 36);
  });
  it("750 alumni → $0.25", () => {
    assert.strictEqual(pickRateCents(ALUMNI_TIERS_MONTHLY, 750), 25);
  });
  it("2,500 alumni → $0.25", () => {
    assert.strictEqual(pickRateCents(ALUMNI_TIERS_MONTHLY, 2500), 25);
  });
  it("2,501 alumni → $0.18", () => {
    assert.strictEqual(pickRateCents(ALUMNI_TIERS_MONTHLY, 2501), 18);
  });
  it("10,000 alumni → $0.18", () => {
    assert.strictEqual(pickRateCents(ALUMNI_TIERS_MONTHLY, 10_000), 18);
  });
});

describe("yearly tiers = 10× monthly", () => {
  it("active yearly tier 1 = $1.50", () => {
    assert.strictEqual(ACTIVE_TIERS_YEARLY[0].unitAmountCents, 150);
  });
  it("alumni yearly tier 3 = $1.80", () => {
    assert.strictEqual(ALUMNI_TIERS_YEARLY[2].unitAmountCents, 180);
  });
});

describe("isPerUserSalesLed", () => {
  it("10,000 → not sales-led", () => {
    assert.strictEqual(isPerUserSalesLed(10_000), false);
  });
  it("10,001 → sales-led", () => {
    assert.strictEqual(isPerUserSalesLed(10_001), true);
  });
});

describe("calcPerUserQuote — landing-page calculator parity", () => {
  it("200 actives + 750 alumni monthly = $207.50", () => {
    const q = calcPerUserQuote("month", 200, 750);
    assert.ok(q);
    assert.strictEqual(q.activeRateCents, 10);
    assert.strictEqual(q.alumniRateCents, 25);
    assert.strictEqual(q.activeSubtotalCents, 2000); // $20
    assert.strictEqual(q.alumniSubtotalCents, 18750); // $187.50
    assert.strictEqual(q.totalCents, 20750); // $207.50
  });

  it("100 actives + 0 alumni monthly = $15", () => {
    const q = calcPerUserQuote("month", 100, 0);
    assert.ok(q);
    assert.strictEqual(q.totalCents, 1500);
  });

  it("0 actives + 0 alumni = $0", () => {
    const q = calcPerUserQuote("month", 0, 0);
    assert.ok(q);
    assert.strictEqual(q.totalCents, 0);
  });

  it("yearly equals 10× monthly for same seats", () => {
    const m = calcPerUserQuote("month", 200, 750);
    const y = calcPerUserQuote("year", 200, 750);
    assert.ok(m && y);
    assert.strictEqual(y.totalCents, m.totalCents * 10);
  });

  it("alumni > 10,000 → null (sales-led)", () => {
    assert.strictEqual(calcPerUserQuote("month", 50, 10_001), null);
  });

  it("negative seats → null", () => {
    assert.strictEqual(calcPerUserQuote("month", -1, 0), null);
    assert.strictEqual(calcPerUserQuote("month", 10, -5), null);
  });
});
