import test from "node:test";
import assert from "node:assert/strict";
import {
  extractSubscriptionPeriodEndEpoch,
  extractSubscriptionPeriodEndIso,
} from "../src/lib/stripe/subscription-period.ts";

test("extractSubscriptionPeriodEndIso prefers the subscription-level period end", () => {
  const expectedIso = new Date(1_767_139_200 * 1000).toISOString();
  const subscription = {
    current_period_end: 1_767_139_200,
    items: {
      data: [
        { current_period_end: 1_766_880_000 },
      ],
    },
  };

  assert.strictEqual(extractSubscriptionPeriodEndEpoch(subscription), 1_767_139_200);
  assert.strictEqual(extractSubscriptionPeriodEndIso(subscription), expectedIso);
});

test("extractSubscriptionPeriodEndIso falls back to the earliest item-level period end", () => {
  const expectedIso = new Date(1_767_139_200 * 1000).toISOString();
  const subscription = {
    items: {
      data: [
        { current_period_end: 1_767_225_600 },
        { current_period_end: 1_767_139_200 },
      ],
    },
  };

  assert.strictEqual(extractSubscriptionPeriodEndEpoch(subscription), 1_767_139_200);
  assert.strictEqual(extractSubscriptionPeriodEndIso(subscription), expectedIso);
});

test("extractSubscriptionPeriodEndIso returns null when Stripe exposes no period end", () => {
  const subscription = {
    current_period_end: null,
    items: {
      data: [
        { current_period_end: null },
      ],
    },
  };

  assert.strictEqual(extractSubscriptionPeriodEndEpoch(subscription), null);
  assert.strictEqual(extractSubscriptionPeriodEndIso(subscription), null);
});
