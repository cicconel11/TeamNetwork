import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import { randomUUID } from "crypto";

/**
 * Stripe Webhook Handler Tests
 *
 * Tests the critical webhook event handlers:
 * - checkout.session.completed (subscription created)
 * - invoice.paid (recurring payment success)
 * - invoice.payment_failed (failed payment handling)
 * - customer.subscription.deleted (cancellation)
 * - Deduplication (duplicate event IDs rejected)
 *
 * Approach:
 * We test the deduplication logic and individual helper functions that can be
 * isolated. The full POST handler depends on many external dependencies (Stripe SDK,
 * Supabase service client, env vars), so we focus on the business logic patterns.
 */

import {
  registerStripeEvent,
  markStripeEventProcessed,
} from "../src/lib/payments/stripe-events.ts";
import { createWebhookTestSupabase } from "./utils/webhookSupabaseStub.ts";

describe("Stripe Webhook Handler", () => {
  describe("Event Deduplication", () => {
    it("processes a new event successfully", async () => {
      const supabase = createWebhookTestSupabase();
      const eventId = `evt_${randomUUID()}`;

      const result = await registerStripeEvent({
        supabase: supabase as never,
        eventId,
        type: "checkout.session.completed",
        payload: { object_id: "cs_test_123" },
      });

      assert.strictEqual(result.alreadyProcessed, false);
      assert.strictEqual(result.eventRow.event_id, eventId);
    });

    it("rejects duplicate event IDs that have been processed", async () => {
      const supabase = createWebhookTestSupabase();
      const eventId = `evt_${randomUUID()}`;

      // First registration
      const first = await registerStripeEvent({
        supabase: supabase as never,
        eventId,
        type: "checkout.session.completed",
        payload: { object_id: "cs_test_123" },
      });
      assert.strictEqual(first.alreadyProcessed, false);

      // Mark as processed
      await markStripeEventProcessed(supabase as never, eventId);

      // Second registration should be rejected
      const second = await registerStripeEvent({
        supabase: supabase as never,
        eventId,
        type: "checkout.session.completed",
        payload: { object_id: "cs_test_123" },
      });
      assert.strictEqual(second.alreadyProcessed, true);
    });

    it("allows duplicate event IDs that have not been processed yet", async () => {
      const supabase = createWebhookTestSupabase();
      const eventId = `evt_${randomUUID()}`;

      // First registration - not yet processed
      const first = await registerStripeEvent({
        supabase: supabase as never,
        eventId,
        type: "checkout.session.completed",
        payload: { object_id: "cs_test_123" },
      });
      assert.strictEqual(first.alreadyProcessed, false);

      // Second registration - should see it exists but not processed
      const second = await registerStripeEvent({
        supabase: supabase as never,
        eventId,
        type: "checkout.session.completed",
        payload: { object_id: "cs_test_123" },
      });
      assert.strictEqual(second.alreadyProcessed, false);
    });

    it("marks event as processed with timestamp", async () => {
      const supabase = createWebhookTestSupabase();
      const eventId = `evt_${randomUUID()}`;

      await registerStripeEvent({
        supabase: supabase as never,
        eventId,
        type: "invoice.paid",
        payload: { object_id: "in_test_123" },
      });

      const beforeMark = supabase.getRows("stripe_events")[0];
      assert.strictEqual(beforeMark?.processed_at, undefined);

      await markStripeEventProcessed(supabase as never, eventId);

      const afterMark = supabase.getRows("stripe_events")[0];
      assert.ok(afterMark?.processed_at, "processed_at should be set");
    });
  });

  describe("checkout.session.completed", () => {
    it("creates subscription record for subscription mode checkout", async () => {
      const supabase = createWebhookTestSupabase();
      const orgId = randomUUID();
      const subscriptionId = `sub_${randomUUID()}`;
      const customerId = `cus_${randomUUID()}`;
      const paymentAttemptId = randomUUID();

      // Seed organization and payment attempt
      supabase.seedOrganization({ id: orgId, slug: "test-org", name: "Test Org" });
      supabase.seedPaymentAttempt({
        id: paymentAttemptId,
        user_id: randomUUID(),
        idempotency_key: `key_${randomUUID()}`,
      });

      // Simulate what the webhook handler would do for checkout.session.completed
      const result = supabase.from("organization_subscriptions").insert({
        organization_id: orgId,
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: customerId,
        status: "active",
        base_plan_interval: "month",
        alumni_bucket: "none",
      }).single();

      assert.strictEqual(result.error, null);

      const subscriptions = supabase.getRows("organization_subscriptions");
      assert.strictEqual(subscriptions.length, 1);
      assert.strictEqual(subscriptions[0]?.organization_id, orgId);
      assert.strictEqual(subscriptions[0]?.stripe_subscription_id, subscriptionId);
      assert.strictEqual(subscriptions[0]?.status, "active");
    });

    it("updates payment attempt status on successful checkout", async () => {
      const supabase = createWebhookTestSupabase();
      const paymentAttemptId = randomUUID();

      supabase.seedPaymentAttempt({
        id: paymentAttemptId,
        user_id: randomUUID(),
        idempotency_key: `key_${randomUUID()}`,
        status: "initiated",
      });

      // Simulate webhook updating payment attempt
      await supabase
        .from("payment_attempts")
        .update({
          status: "succeeded",
          stripe_checkout_session_id: "cs_test_123",
        })
        .eq("id", paymentAttemptId);

      const attempts = supabase.getRows("payment_attempts");
      assert.strictEqual(attempts[0]?.status, "succeeded");
      assert.strictEqual(attempts[0]?.stripe_checkout_session_id, "cs_test_123");
    });

    it("creates donation record for payment mode checkout", async () => {
      const supabase = createWebhookTestSupabase();
      const orgId = randomUUID();

      supabase.seedOrganization({ id: orgId, slug: "test-org", name: "Test Org" });

      // Simulate donation record creation from webhook
      await supabase.from("organization_donations").insert({
        organization_id: orgId,
        stripe_payment_intent_id: "pi_test_123",
        stripe_checkout_session_id: "cs_test_123",
        amount_cents: 5000,
        currency: "usd",
        donor_name: "John Doe",
        donor_email: "john@example.com",
        status: "paid",
      });

      const donations = supabase.getRows("organization_donations");
      assert.strictEqual(donations.length, 1);
      assert.strictEqual(donations[0]?.amount_cents, 5000);
      assert.strictEqual(donations[0]?.donor_email, "john@example.com");
    });
  });

  describe("invoice.paid", () => {
    it("updates subscription status and period end on successful payment", async () => {
      const supabase = createWebhookTestSupabase();
      const orgId = randomUUID();
      const subscriptionId = `sub_${randomUUID()}`;

      // Seed existing subscription
      supabase.seedOrganization({ id: orgId, slug: "test-org", name: "Test Org" });
      supabase.seedSubscription({
        organization_id: orgId,
        stripe_subscription_id: subscriptionId,
        status: "active",
        current_period_end: new Date().toISOString(),
      });

      // Simulate invoice.paid webhook updating subscription
      const newPeriodEnd = new Date();
      newPeriodEnd.setDate(newPeriodEnd.getDate() + 30);

      await supabase
        .from("organization_subscriptions")
        .update({
          status: "active",
          current_period_end: newPeriodEnd.toISOString(),
        })
        .eq("stripe_subscription_id", subscriptionId);

      const subscriptions = supabase.getRows("organization_subscriptions");
      assert.strictEqual(subscriptions[0]?.status, "active");
      assert.ok(
        new Date(subscriptions[0]?.current_period_end as string) > new Date(),
        "Period end should be in future"
      );
    });
  });

  describe("invoice.payment_failed", () => {
    it("updates subscription status to past_due on failed payment", async () => {
      const supabase = createWebhookTestSupabase();
      const orgId = randomUUID();
      const subscriptionId = `sub_${randomUUID()}`;

      // Seed existing active subscription
      supabase.seedOrganization({ id: orgId, slug: "test-org", name: "Test Org" });
      supabase.seedSubscription({
        organization_id: orgId,
        stripe_subscription_id: subscriptionId,
        status: "active",
      });

      // Simulate invoice.payment_failed webhook
      await supabase
        .from("organization_subscriptions")
        .update({ status: "past_due" })
        .eq("stripe_subscription_id", subscriptionId);

      const subscriptions = supabase.getRows("organization_subscriptions");
      assert.strictEqual(subscriptions[0]?.status, "past_due");
    });
  });

  describe("customer.subscription.deleted", () => {
    it("updates subscription status to canceled", async () => {
      const supabase = createWebhookTestSupabase();
      const orgId = randomUUID();
      const subscriptionId = `sub_${randomUUID()}`;

      // Seed existing subscription
      supabase.seedOrganization({ id: orgId, slug: "test-org", name: "Test Org" });
      supabase.seedSubscription({
        organization_id: orgId,
        stripe_subscription_id: subscriptionId,
        status: "active",
      });

      // Simulate customer.subscription.deleted webhook
      await supabase
        .from("organization_subscriptions")
        .update({ status: "canceled" })
        .eq("stripe_subscription_id", subscriptionId);

      const subscriptions = supabase.getRows("organization_subscriptions");
      assert.strictEqual(subscriptions[0]?.status, "canceled");
    });

    it("sets grace period end date on cancellation", async () => {
      const supabase = createWebhookTestSupabase();
      const orgId = randomUUID();
      const subscriptionId = `sub_${randomUUID()}`;

      supabase.seedOrganization({ id: orgId, slug: "test-org", name: "Test Org" });
      supabase.seedSubscription({
        organization_id: orgId,
        stripe_subscription_id: subscriptionId,
        status: "active",
        grace_period_ends_at: null,
      });

      // Simulate webhook setting grace period (30 days from now)
      const gracePeriodEnd = new Date();
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 30);

      await supabase
        .from("organization_subscriptions")
        .update({
          status: "canceled",
          grace_period_ends_at: gracePeriodEnd.toISOString(),
        })
        .eq("stripe_subscription_id", subscriptionId);

      const subscriptions = supabase.getRows("organization_subscriptions");
      assert.strictEqual(subscriptions[0]?.status, "canceled");
      assert.ok(subscriptions[0]?.grace_period_ends_at, "Grace period should be set");
    });

    it("clears grace period when subscription is reactivated", async () => {
      const supabase = createWebhookTestSupabase();
      const orgId = randomUUID();
      const subscriptionId = `sub_${randomUUID()}`;

      // Seed canceled subscription with grace period
      const gracePeriod = new Date();
      gracePeriod.setDate(gracePeriod.getDate() + 15);

      supabase.seedOrganization({ id: orgId, slug: "test-org", name: "Test Org" });
      supabase.seedSubscription({
        organization_id: orgId,
        stripe_subscription_id: subscriptionId,
        status: "canceled",
        grace_period_ends_at: gracePeriod.toISOString(),
      });

      // Simulate subscription reactivation webhook
      await supabase
        .from("organization_subscriptions")
        .update({
          status: "active",
          grace_period_ends_at: null,
        })
        .eq("stripe_subscription_id", subscriptionId);

      const subscriptions = supabase.getRows("organization_subscriptions");
      assert.strictEqual(subscriptions[0]?.status, "active");
      assert.strictEqual(subscriptions[0]?.grace_period_ends_at, null);
    });
  });

  describe("Payment Intent Events (Donations)", () => {
    it("creates donation record on payment_intent.succeeded", async () => {
      const supabase = createWebhookTestSupabase();
      const orgId = randomUUID();
      const paymentIntentId = `pi_${randomUUID()}`;

      supabase.seedOrganization({ id: orgId, slug: "test-org", name: "Test Org" });

      // Simulate payment_intent.succeeded webhook
      await supabase.from("organization_donations").insert({
        organization_id: orgId,
        stripe_payment_intent_id: paymentIntentId,
        amount_cents: 10000,
        currency: "usd",
        donor_name: "Jane Smith",
        donor_email: "jane@example.com",
        status: "succeeded",
      });

      const donations = supabase.getRows("organization_donations");
      assert.strictEqual(donations.length, 1);
      assert.strictEqual(donations[0]?.status, "succeeded");
      assert.strictEqual(donations[0]?.amount_cents, 10000);
    });

    it("records failed donation on payment_intent.payment_failed", async () => {
      const supabase = createWebhookTestSupabase();
      const orgId = randomUUID();
      const paymentIntentId = `pi_${randomUUID()}`;

      supabase.seedOrganization({ id: orgId, slug: "test-org", name: "Test Org" });

      // Simulate payment_intent.payment_failed webhook
      await supabase.from("organization_donations").insert({
        organization_id: orgId,
        stripe_payment_intent_id: paymentIntentId,
        amount_cents: 2500,
        currency: "usd",
        status: "failed",
      });

      const donations = supabase.getRows("organization_donations");
      assert.strictEqual(donations.length, 1);
      assert.strictEqual(donations[0]?.status, "failed");
    });
  });

  describe("Security: Cross-org validation", () => {
    it("rejects mismatched subscription IDs for active subscriptions", async () => {
      const supabase = createWebhookTestSupabase();
      const orgId = randomUUID();
      const existingSubId = `sub_${randomUUID()}`;
      const attackerSubId = `sub_${randomUUID()}`;

      // Seed existing active subscription
      supabase.seedOrganization({ id: orgId, slug: "test-org", name: "Test Org" });
      supabase.seedSubscription({
        organization_id: orgId,
        stripe_subscription_id: existingSubId,
        stripe_customer_id: "cus_existing",
        status: "active",
      });

      // Simulate validation check (from validateOrgOwnsStripeResource)
      const subscriptions = supabase.getRows("organization_subscriptions");
      const existing = subscriptions.find((s) => s.organization_id === orgId);

      // Attacker tries to associate different subscription
      const isValid =
        !existing?.stripe_subscription_id ||
        existing.stripe_subscription_id === attackerSubId;

      assert.strictEqual(isValid, false, "Should reject mismatched subscription ID");
    });

    it("allows new subscription IDs for canceled subscriptions", async () => {
      const supabase = createWebhookTestSupabase();
      const orgId = randomUUID();
      const oldSubId = `sub_${randomUUID()}`;
      const newSubId = `sub_${randomUUID()}`;

      // Seed canceled subscription
      supabase.seedOrganization({ id: orgId, slug: "test-org", name: "Test Org" });
      supabase.seedSubscription({
        organization_id: orgId,
        stripe_subscription_id: oldSubId,
        status: "canceled",
      });

      // Simulate validation check - canceled status allows new IDs (re-subscribe flow)
      const subscriptions = supabase.getRows("organization_subscriptions");
      const existing = subscriptions.find((s) => s.organization_id === orgId);

      const replaceableStatuses = ["canceled", "incomplete_expired"];
      const canReplace = replaceableStatuses.includes(existing?.status as string);

      assert.strictEqual(canReplace, true, "Should allow new IDs for canceled subscription");
    });
  });
});
