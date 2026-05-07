import test from "node:test";
import assert from "node:assert/strict";
import { hashFingerprint } from "../src/lib/payments/idempotency.ts";
import {
  buildOrgCheckoutFingerprintPayload,
  getOrgFreeTrialRequestError,
  isOrgFreeTrialSelectable,
  isOrgTrialMetadata,
  shouldProvisionOrgCheckoutOnCompletion,
} from "../src/lib/subscription/org-trial.ts";

test("monthly self-serve org plans can offer the free-trial option", () => {
  assert.equal(
    isOrgFreeTrialSelectable({ billingInterval: "month", alumniBucket: "none" }),
    true,
  );
  assert.equal(
    isOrgFreeTrialSelectable({ billingInterval: "month", alumniBucket: "2500-5000" }),
    true,
  );
});

test("yearly and sales-led plans reject the free-trial option", () => {
  assert.equal(
    getOrgFreeTrialRequestError({
      withTrial: true,
      billingInterval: "year",
      alumniBucket: "none",
    }),
    "Free trial is only available on monthly plans.",
  );

  assert.equal(
    getOrgFreeTrialRequestError({
      withTrial: true,
      billingInterval: "month",
      alumniBucket: "5000+",
    }),
    "Free trial is not available for custom alumni pricing.",
  );
});

test("checkout fingerprints differ when trial selection changes", () => {
  const basePayload = {
    userId: "user_123",
    name: "Test Org",
    slug: "test-org",
    interval: "month" as const,
    bucket: "none" as const,
    primaryColor: "#1e3a5f",
  };

  const payNowFingerprint = hashFingerprint(
    buildOrgCheckoutFingerprintPayload({
      ...basePayload,
      withTrial: false,
    }),
  );
  const trialFingerprint = hashFingerprint(
    buildOrgCheckoutFingerprintPayload({
      ...basePayload,
      withTrial: true,
    }),
  );

  assert.notEqual(payNowFingerprint, trialFingerprint);
});

test("trial checkout sessions can provision after checkout without an immediate charge", () => {
  assert.equal(
    shouldProvisionOrgCheckoutOnCompletion("no_payment_required", { is_trial: "true" }),
    true,
  );
  assert.equal(isOrgTrialMetadata({ is_trial: "true" }), true);
  assert.equal(
    shouldProvisionOrgCheckoutOnCompletion("no_payment_required", { is_trial: "false" }),
    false,
  );
  assert.equal(shouldProvisionOrgCheckoutOnCompletion("paid", { is_trial: "false" }), true);
});
