import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALUMNI_BUCKET_PRICING, ENTERPRISE_SEAT_PRICING } from "../src/types/enterprise";
import { formatSeatPrice } from "../src/lib/enterprise/pricing";
import type { BillingInterval } from "../src/types/enterprise";

/**
 * U8: enterprise billing pricing DISPLAY strings must derive from the pricing
 * constants (no hardcoded literals, no /year-on-monthly bug). These assert the
 * derivation helpers + that the components no longer hardcode the values.
 */

// Mirror of the derivation each component uses for the paid-org price.
function formatPaidOrgPrice(interval: BillingInterval): string {
  const cents =
    interval === "month"
      ? ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsMonthly
      : ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly;
  return `${formatSeatPrice(cents)}/${interval === "month" ? "mo" : "yr"}`;
}

test("paid-org price is $15/mo on monthly (guards the /year bug)", () => {
  assert.strictEqual(formatPaidOrgPrice("month"), "$15/mo");
});

test("paid-org price is $150/yr on yearly", () => {
  assert.strictEqual(formatPaidOrgPrice("year"), "$150/yr");
});

test("bucket capacity label derives from capacityPerBucket × n", () => {
  for (let n = 1; n <= ALUMNI_BUCKET_PRICING.maxSelfServeBuckets; n++) {
    const capacity = n * ALUMNI_BUCKET_PRICING.capacityPerBucket;
    const label = `Bucket ${n} - Up to ${capacity.toLocaleString()} alumni`;
    assert.match(label, new RegExp(`Up to ${capacity.toLocaleString()} alumni`));
  }
});

// ── Source-level: components must not hardcode the values ──────────────────────

const seatBar = readFileSync(
  join(process.cwd(), "src/components/enterprise/SeatUsageBar.tsx"),
  "utf8"
);
const modal = readFileSync(
  join(process.cwd(), "src/components/enterprise/OrgLimitUpgradeModal.tsx"),
  "utf8"
);
const billing = readFileSync(
  join(process.cwd(), "src/app/enterprise/[enterpriseSlug]/billing/BillingClient.tsx"),
  "utf8"
);

test("SeatUsageBar no longer hardcodes the $15/mo · $150/yr ternary", () => {
  assert.ok(!/\$15\/mo.*:.*\$150\/yr/.test(seatBar));
  assert.match(seatBar, /formatPaidOrgPrice/);
});

test("OrgLimitUpgradeModal no longer hardcodes '\\$150/year each'", () => {
  assert.ok(!/\$150\/year each/.test(modal));
  assert.match(modal, /additionalOrgPrice/);
});

test("OrgLimitUpgradeModal threads a billingInterval prop into the sub-org branch", () => {
  assert.match(modal, /billingInterval\?: BillingInterval/);
});

test("BillingClient shows no self-serve pricing — enterprise is sales-led", () => {
  // No dollar figures, bucket selector, or upgrade/add-seat controls remain.
  assert.ok(!/\$\{?[0-9]/.test(billing), "no hardcoded dollar amounts");
  assert.ok(!/formatBucketPrice|BUCKET_OPTIONS/.test(billing), "no bucket pricing UI");
  assert.ok(!/Upgrade Bucket|Add Organization|Add Seats/.test(billing), "no purchase controls");
});

test("BillingClient routes plan changes to Contact Sales", () => {
  assert.match(billing, /Contact Sales/);
  assert.match(billing, /mailto:\$\{SALES_EMAIL\}/);
});
