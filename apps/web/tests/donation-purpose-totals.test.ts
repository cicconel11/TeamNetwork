import test from "node:test";
import assert from "node:assert/strict";
import { buildDonationPurposeTotals } from "../src/lib/payments/donation-purpose-totals.ts";

test("buildDonationPurposeTotals uses the fallback label for null purposes", () => {
  const totals = buildDonationPurposeTotals(
    [
      { purpose: null, amount_cents: 2500 },
      { purpose: "Annual Fund", amount_cents: 5000 },
      { purpose: null, amount_cents: 750 },
    ],
    "General support",
  );

  assert.deepEqual(totals, {
    "General support": 3250,
    "Annual Fund": 5000,
  });
});

test("buildDonationPurposeTotals returns an empty object when there are no donations", () => {
  const totals = buildDonationPurposeTotals([], "General support");

  assert.deepEqual(totals, {});
});
