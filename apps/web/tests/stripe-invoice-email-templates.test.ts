import test, { describe } from "node:test";
import assert from "node:assert";
import {
  buildRenewalReminderEmail,
  buildPaymentActionRequiredEmail,
  buildFinalizationFailedEmail,
} from "../src/lib/stripe/invoice-email-templates.ts";

describe("Invoice email templates", () => {
  const ctx = { entityName: "Alpha Chapter" };

  describe("buildRenewalReminderEmail", () => {
    test("returns the full renewal reminder contract", () => {
      const result = buildRenewalReminderEmail("March 15, 2026", "$99.00", ctx);

      assert.deepStrictEqual(result, {
        subject: "Subscription Renewal Reminder - Alpha Chapter",
        body: `Your subscription for Alpha Chapter renews on March 15, 2026 for $99.00.

If you need to update your payment method or make changes to your plan, please check your billing settings before the renewal date.

No action is needed if everything looks correct.`,
      });
    });
  });

  describe("buildPaymentActionRequiredEmail", () => {
    test("returns the full payment authentication contract", () => {
      const url = "https://invoice.stripe.com/i/acct_123/test_abc";
      const result = buildPaymentActionRequiredEmail(url, ctx);

      assert.deepStrictEqual(result, {
        subject: "[Action Required] Payment Authentication Needed - Alpha Chapter",
        body: `Your recent payment for Alpha Chapter requires additional authentication to complete.

Please complete the payment verification here:
https://invoice.stripe.com/i/acct_123/test_abc

This is typically required by your bank for security purposes (3D Secure). Your subscription may be interrupted if the payment is not completed.`,
      });
    });
  });

  describe("buildFinalizationFailedEmail", () => {
    test("includes a dedicated error details section when provided", () => {
      const result = buildFinalizationFailedEmail("Card declined", ctx);

      assert.deepStrictEqual(result, {
        subject: "[Action Required] Billing Issue - Alpha Chapter",
        body: `An invoice for Alpha Chapter could not be processed.

Error details: Card declined

Please check your billing settings to ensure your payment information is up to date. If this issue persists, contact support for assistance.`,
      });
    });

    test("omits the error details section cleanly when Stripe provides no message", () => {
      const result = buildFinalizationFailedEmail(null, ctx);

      assert.deepStrictEqual(result, {
        subject: "[Action Required] Billing Issue - Alpha Chapter",
        body: `An invoice for Alpha Chapter could not be processed.

Please check your billing settings to ensure your payment information is up to date. If this issue persists, contact support for assistance.`,
      });
      assert.ok(!result.body.includes("Error details:"));
      assert.ok(!result.body.includes("null"));
      assert.ok(!result.body.includes("undefined"));
    });
  });
});
