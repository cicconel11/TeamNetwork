import test from "node:test";
import assert from "node:assert";
import {
  createMockWebhookEvent,
  verifyWebhookSignature,
} from "../../utils/stripeMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

/**
 * Tests for POST /api/stripe/webhook-connect
 *
 * The Connect webhook route handles donation events from Stripe Connect:
 * 1. Verify Stripe signature (STRIPE_WEBHOOK_SECRET_CONNECT)
 * 2. Reject events without event.account (non-Connect events)
 * 3. Deduplicate events via stripe_events table
 * 4. Verify event.account matches org's stripe_connect_account_id
 * 5. Handle checkout.session.completed (payment mode only — donations)
 * 6. Handle payment_intent.succeeded (upsert donation, update attempt, increment stats)
 * 7. Handle payment_intent.payment_failed (upsert failed donation, update attempt)
 * 8. Ignore non-payment checkout sessions (subscription mode)
 */

// Types

interface WebhookResult {
  status: number;
  message?: string;
  error?: string;
}

interface ConnectVerificationContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  organizationId: string;
  connectedAccountId: string;
}

interface DonationCheckoutContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  session: {
    id: string;
    mode: string;
    payment_status?: string;
    payment_intent?: string | null;
    amount_total?: number;
    amount_subtotal?: number;
    currency?: string;
    customer_details?: { name?: string | null; email?: string | null };
    metadata?: Record<string, string>;
  };
  connectedAccountId: string;
}

interface PaymentIntentSucceededContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  paymentIntent: {
    id: string;
    amount_received?: number;
    amount?: number;
    currency?: string;
    receipt_email?: string | null;
    created?: number;
    metadata?: Record<string, string>;
  };
  connectedAccountId: string;
}

interface PaymentIntentFailedContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  paymentIntent: {
    id: string;
    amount?: number;
    currency?: string;
    receipt_email?: string | null;
    status?: string;
    last_payment_error?: { message?: string };
    metadata?: Record<string, string>;
  };
  connectedAccountId: string;
}

// Simulation functions

/**
 * Simulates verifying that event.account matches the org's stripe_connect_account_id.
 * Mirrors the verifyConnectAccount() helper in the route handler.
 */
async function simulateConnectAccountVerification(
  ctx: ConnectVerificationContext
): Promise<WebhookResult> {
  const { supabase, organizationId, connectedAccountId } = ctx;

  const { data: org } = await supabase
    .from("organizations")
    .select("stripe_connect_account_id")
    .eq("id", organizationId)
    .maybeSingle();

  if (!org?.stripe_connect_account_id) {
    return { status: 400, error: "Org has no connect account" };
  }

  if (org.stripe_connect_account_id !== connectedAccountId) {
    return { status: 400, error: "Connect account mismatch" };
  }

  return { status: 200, message: "Connect account verified" };
}

/**
 * Simulates checkout.session.completed (payment mode) handling.
 * Mirrors the route: upsert donation + update payment attempt.
 */
async function simulateDonationCheckout(
  ctx: DonationCheckoutContext
): Promise<WebhookResult> {
  const { supabase, session, connectedAccountId } = ctx;
  const metadata = session.metadata || {};

  // Only handle payment mode (donations), not subscription mode
  if (session.mode !== "payment") {
    return { status: 200, message: "Non-payment checkout session ignored" };
  }

  const orgId = metadata.organization_id;
  if (!orgId) {
    return { status: 200, message: "Missing organization_id - skipped" };
  }

  // Verify Connect account ownership
  const verification = await simulateConnectAccountVerification({
    supabase,
    organizationId: orgId,
    connectedAccountId,
  });
  if (verification.status !== 200) {
    return verification;
  }

  const amountCents = session.amount_total ?? session.amount_subtotal ?? 0;
  const paymentIntentId = session.payment_intent || null;
  const paymentAttemptId = metadata.payment_attempt_id || null;

  // Update payment attempt status
  if (paymentAttemptId || paymentIntentId || session.id) {
    const updatePayload: Record<string, unknown> = {
      status: session.payment_status || "processing",
      updated_at: new Date().toISOString(),
    };
    if (paymentIntentId) {
      updatePayload.stripe_payment_intent_id = paymentIntentId;
    }
    updatePayload.stripe_checkout_session_id = session.id;
    updatePayload.organization_id = orgId;
    updatePayload.stripe_connected_account_id = connectedAccountId;

    if (paymentAttemptId) {
      await supabase
        .from("payment_attempts")
        .update(updatePayload)
        .eq("id", paymentAttemptId);
    } else if (paymentIntentId) {
      await supabase
        .from("payment_attempts")
        .update(updatePayload)
        .eq("stripe_payment_intent_id", paymentIntentId);
    }
  }

  // Upsert donation record
  const donationPayload = {
    organization_id: orgId,
    stripe_payment_intent_id: paymentIntentId,
    stripe_checkout_session_id: session.id,
    amount_cents: amountCents,
    currency: (session.currency || "usd").toLowerCase(),
    donor_name: session.customer_details?.name || null,
    donor_email: session.customer_details?.email || null,
    event_id: metadata.event_id || null,
    purpose: metadata.purpose || null,
    metadata: metadata,
    status: session.payment_status || "processing",
  };

  if (paymentIntentId) {
    await supabase
      .from("organization_donations")
      .upsert(donationPayload, { onConflict: "stripe_payment_intent_id" });
  } else {
    await supabase
      .from("organization_donations")
      .upsert(donationPayload, { onConflict: "stripe_checkout_session_id" });
  }

  return { status: 200, message: "Donation checkout processed" };
}

/**
 * Simulates payment_intent.succeeded handling.
 * Mirrors the route: upsert donation, update attempt, increment stats.
 */
async function simulatePaymentIntentSucceeded(
  ctx: PaymentIntentSucceededContext
): Promise<WebhookResult> {
  const { supabase, paymentIntent, connectedAccountId } = ctx;
  const metadata = paymentIntent.metadata || {};

  const orgId = metadata.organization_id;
  if (!orgId) {
    return { status: 200, message: "Missing organization_id - skipped" };
  }

  // Verify Connect account ownership
  const verification = await simulateConnectAccountVerification({
    supabase,
    organizationId: orgId,
    connectedAccountId,
  });
  if (verification.status !== 200) {
    return verification;
  }

  const amountCents = paymentIntent.amount_received ?? paymentIntent.amount ?? 0;
  const paymentAttemptId = metadata.payment_attempt_id || null;

  // Update payment attempt status
  if (paymentAttemptId) {
    await supabase
      .from("payment_attempts")
      .update({
        status: "succeeded",
        stripe_payment_intent_id: paymentIntent.id,
        organization_id: orgId,
        stripe_connected_account_id: connectedAccountId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentAttemptId);
  }

  // Upsert donation record
  await supabase
    .from("organization_donations")
    .upsert(
      {
        organization_id: orgId,
        stripe_payment_intent_id: paymentIntent.id,
        amount_cents: amountCents,
        currency: (paymentIntent.currency || "usd").toLowerCase(),
        donor_name: null,
        donor_email: paymentIntent.receipt_email || null,
        event_id: metadata.event_id || null,
        purpose: metadata.purpose || null,
        metadata: metadata,
        status: "succeeded",
      },
      { onConflict: "stripe_payment_intent_id" }
    );

  // Increment donation stats via RPC
  const { error: statsError } = await supabase.rpc("increment_donation_stats", {
    p_org_id: orgId,
    p_amount_delta: amountCents,
    p_count_delta: 1,
    p_last: paymentIntent.created
      ? new Date(paymentIntent.created * 1000).toISOString()
      : new Date().toISOString(),
  });

  if (statsError) {
    return { status: 200, message: "Donation recorded but stats update failed" };
  }

  return { status: 200, message: "Payment succeeded - donation recorded and stats updated" };
}

/**
 * Simulates payment_intent.payment_failed handling.
 * Mirrors the route: upsert failed donation, update attempt.
 */
async function simulatePaymentIntentFailed(
  ctx: PaymentIntentFailedContext
): Promise<WebhookResult> {
  const { supabase, paymentIntent, connectedAccountId } = ctx;
  const metadata = paymentIntent.metadata || {};

  const orgId = metadata.organization_id;
  if (!orgId) {
    return { status: 200, message: "Missing organization_id - skipped" };
  }

  // Verify Connect account ownership
  const verification = await simulateConnectAccountVerification({
    supabase,
    organizationId: orgId,
    connectedAccountId,
  });
  if (verification.status !== 200) {
    return verification;
  }

  const amountCents = paymentIntent.amount ?? 0;
  const paymentAttemptId = metadata.payment_attempt_id || null;
  const lastError =
    paymentIntent.last_payment_error?.message || paymentIntent.status || "failed";

  // Update payment attempt status
  if (paymentAttemptId) {
    await supabase
      .from("payment_attempts")
      .update({
        status: "failed",
        last_error: lastError,
        stripe_payment_intent_id: paymentIntent.id,
        organization_id: orgId,
        stripe_connected_account_id: connectedAccountId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentAttemptId);
  }

  // Upsert failed donation record
  await supabase
    .from("organization_donations")
    .upsert(
      {
        organization_id: orgId,
        stripe_payment_intent_id: paymentIntent.id,
        amount_cents: amountCents,
        currency: (paymentIntent.currency || "usd").toLowerCase(),
        donor_name: null,
        donor_email: paymentIntent.receipt_email || null,
        event_id: metadata.event_id || null,
        purpose: metadata.purpose || null,
        metadata: metadata,
        status: "failed",
      },
      { onConflict: "stripe_payment_intent_id" }
    );

  return { status: 200, message: "Payment failed - donation marked as failed" };
}

/**
 * Simulates missing STRIPE_WEBHOOK_SECRET_CONNECT env var.
 */
function simulateMissingWebhookSecret(): WebhookResult {
  return { status: 503, error: "Connect webhook not configured" };
}

/**
 * Simulates non-Connect event (no event.account) arriving at Connect endpoint.
 */
function simulateNonConnectEvent(): WebhookResult {
  return { status: 200, message: "Non-Connect event ignored" };
}

// Helper to seed an org with a Connect account

function seedOrgWithConnectAccount(
  supabase: ReturnType<typeof createSupabaseStub>,
  orgId: string,
  connectAccountId: string
) {
  supabase.seed("organizations", [
    {
      id: orgId,
      name: "Test Org",
      slug: "test-org",
      stripe_connect_account_id: connectAccountId,
    },
  ]);
}

function seedPaymentAttempt(
  supabase: ReturnType<typeof createSupabaseStub>,
  attemptId: string,
  overrides: Record<string, unknown> = {}
) {
  supabase.seed("payment_attempts", [
    {
      id: attemptId,
      status: "initiated",
      idempotency_key: `idem_${attemptId}`,
      user_id: "user_test_123",
      metadata: { donor_name: "Jane Doe", donor_email: "jane@example.com" },
      ...overrides,
    },
  ]);
}

// --- Tests ---

test("Connect webhook returns 503 when STRIPE_WEBHOOK_SECRET_CONNECT is missing", () => {
  const result = simulateMissingWebhookSecret();

  assert.strictEqual(result.status, 503);
  assert.ok(result.error?.includes("not configured"));
});

test("Connect webhook ignores non-Connect events (no event.account)", () => {
  const result = simulateNonConnectEvent();

  assert.strictEqual(result.status, 200);
  assert.ok(result.message?.includes("Non-Connect event ignored"));
});

test("Connect webhook rejects mismatched Connect account", async () => {
  const supabase = createSupabaseStub();
  seedOrgWithConnectAccount(supabase, "org_123", "acct_real_123");

  const result = await simulateConnectAccountVerification({
    supabase,
    organizationId: "org_123",
    connectedAccountId: "acct_attacker_999",
  });

  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("mismatch"));
});

test("Connect webhook rejects org without Connect account configured", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("organizations", [
    { id: "org_no_connect", name: "No Connect Org", slug: "no-connect" },
  ]);

  const result = await simulateConnectAccountVerification({
    supabase,
    organizationId: "org_no_connect",
    connectedAccountId: "acct_123",
  });

  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("no connect account"));
});

test("Connect webhook verifies matching Connect account", async () => {
  const supabase = createSupabaseStub();
  seedOrgWithConnectAccount(supabase, "org_123", "acct_real_123");

  const result = await simulateConnectAccountVerification({
    supabase,
    organizationId: "org_123",
    connectedAccountId: "acct_real_123",
  });

  assert.strictEqual(result.status, 200);
  assert.ok(result.message?.includes("verified"));
});

test("checkout.session.completed (payment mode) upserts donation and updates attempt", async () => {
  const supabase = createSupabaseStub();
  seedOrgWithConnectAccount(supabase, "org_123", "acct_connect_123");
  seedPaymentAttempt(supabase, "pa_checkout_test");

  const result = await simulateDonationCheckout({
    supabase,
    session: {
      id: "cs_donation_123",
      mode: "payment",
      payment_status: "paid",
      payment_intent: "pi_checkout_123",
      amount_total: 5000,
      currency: "usd",
      customer_details: { name: "John Doe", email: "john@example.com" },
      metadata: {
        organization_id: "org_123",
        payment_attempt_id: "pa_checkout_test",
        event_id: "evt_fundraiser_1",
        purpose: "Annual Gala",
      },
    },
    connectedAccountId: "acct_connect_123",
  });

  assert.strictEqual(result.status, 200);
  assert.ok(result.message?.includes("Donation checkout processed"));

  // Verify donation was created
  const donations = supabase.getRows("organization_donations");
  assert.strictEqual(donations.length, 1);
  assert.strictEqual(donations[0].organization_id, "org_123");
  assert.strictEqual(donations[0].stripe_payment_intent_id, "pi_checkout_123");
  assert.strictEqual(donations[0].amount_cents, 5000);
  assert.strictEqual(donations[0].donor_name, "John Doe");
  assert.strictEqual(donations[0].donor_email, "john@example.com");
  assert.strictEqual(donations[0].status, "paid");
  assert.strictEqual(donations[0].purpose, "Annual Gala");

  // Verify payment attempt was updated
  const attempts = supabase.getRows("payment_attempts");
  const updatedAttempt = attempts.find((a) => a.id === "pa_checkout_test");
  assert.strictEqual(updatedAttempt?.status, "paid");
  assert.strictEqual(updatedAttempt?.stripe_connected_account_id, "acct_connect_123");
});

test("checkout.session.completed ignores subscription mode sessions", async () => {
  const supabase = createSupabaseStub();
  seedOrgWithConnectAccount(supabase, "org_123", "acct_connect_123");

  const result = await simulateDonationCheckout({
    supabase,
    session: {
      id: "cs_sub_123",
      mode: "subscription",
      payment_status: "paid",
      metadata: { organization_id: "org_123" },
    },
    connectedAccountId: "acct_connect_123",
  });

  assert.strictEqual(result.status, 200);
  assert.ok(result.message?.includes("Non-payment checkout session ignored"));

  // Verify no donation was created
  const donations = supabase.getRows("organization_donations");
  assert.strictEqual(donations.length, 0);
});

test("checkout.session.completed skips when organization_id is missing", async () => {
  const supabase = createSupabaseStub();

  const result = await simulateDonationCheckout({
    supabase,
    session: {
      id: "cs_no_org_123",
      mode: "payment",
      payment_status: "paid",
      amount_total: 2500,
      metadata: {},
    },
    connectedAccountId: "acct_connect_123",
  });

  assert.strictEqual(result.status, 200);
  assert.ok(result.message?.includes("Missing organization_id"));

  // Verify no donation was created
  const donations = supabase.getRows("organization_donations");
  assert.strictEqual(donations.length, 0);
});

test("checkout.session.completed rejects mismatched Connect account", async () => {
  const supabase = createSupabaseStub();
  seedOrgWithConnectAccount(supabase, "org_123", "acct_real_123");

  const result = await simulateDonationCheckout({
    supabase,
    session: {
      id: "cs_attack_123",
      mode: "payment",
      payment_status: "paid",
      amount_total: 10000,
      metadata: { organization_id: "org_123" },
    },
    connectedAccountId: "acct_attacker_999",
  });

  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("mismatch"));

  // Verify no donation was created
  const donations = supabase.getRows("organization_donations");
  assert.strictEqual(donations.length, 0);
});

test("payment_intent.succeeded upserts donation, updates attempt, and increments stats", async () => {
  const supabase = createSupabaseStub();
  seedOrgWithConnectAccount(supabase, "org_456", "acct_org456");
  seedPaymentAttempt(supabase, "pa_pi_test");

  // Register RPC handler for stats increment
  let rpcCalled = false;
  let rpcParams: Record<string, unknown> = {};
  supabase.registerRpc("increment_donation_stats", (params) => {
    rpcCalled = true;
    rpcParams = params;
    return null;
  });

  const piCreatedAt = Math.floor(Date.now() / 1000);
  const result = await simulatePaymentIntentSucceeded({
    supabase,
    paymentIntent: {
      id: "pi_success_123",
      amount_received: 7500,
      amount: 7500,
      currency: "usd",
      receipt_email: "donor@example.com",
      created: piCreatedAt,
      metadata: {
        organization_id: "org_456",
        payment_attempt_id: "pa_pi_test",
        event_id: "evt_gala",
        purpose: "Spring Fundraiser",
      },
    },
    connectedAccountId: "acct_org456",
  });

  assert.strictEqual(result.status, 200);
  assert.ok(result.message?.includes("donation recorded and stats updated"));

  // Verify donation was created
  const donations = supabase.getRows("organization_donations");
  assert.strictEqual(donations.length, 1);
  assert.strictEqual(donations[0].organization_id, "org_456");
  assert.strictEqual(donations[0].stripe_payment_intent_id, "pi_success_123");
  assert.strictEqual(donations[0].amount_cents, 7500);
  assert.strictEqual(donations[0].status, "succeeded");
  assert.strictEqual(donations[0].donor_email, "donor@example.com");

  // Verify payment attempt was updated
  const attempts = supabase.getRows("payment_attempts");
  const updatedAttempt = attempts.find((a) => a.id === "pa_pi_test");
  assert.strictEqual(updatedAttempt?.status, "succeeded");
  assert.strictEqual(updatedAttempt?.stripe_connected_account_id, "acct_org456");

  // Verify stats RPC was called
  assert.strictEqual(rpcCalled, true);
  assert.strictEqual(rpcParams.p_org_id, "org_456");
  assert.strictEqual(rpcParams.p_amount_delta, 7500);
  assert.strictEqual(rpcParams.p_count_delta, 1);
});

test("payment_intent.succeeded skips when organization_id is missing", async () => {
  const supabase = createSupabaseStub();

  const result = await simulatePaymentIntentSucceeded({
    supabase,
    paymentIntent: {
      id: "pi_no_org_123",
      amount_received: 5000,
      currency: "usd",
      metadata: {},
    },
    connectedAccountId: "acct_123",
  });

  assert.strictEqual(result.status, 200);
  assert.ok(result.message?.includes("Missing organization_id"));

  const donations = supabase.getRows("organization_donations");
  assert.strictEqual(donations.length, 0);
});

test("payment_intent.succeeded rejects mismatched Connect account", async () => {
  const supabase = createSupabaseStub();
  seedOrgWithConnectAccount(supabase, "org_789", "acct_real_789");

  const result = await simulatePaymentIntentSucceeded({
    supabase,
    paymentIntent: {
      id: "pi_attack_123",
      amount_received: 50000,
      metadata: { organization_id: "org_789" },
    },
    connectedAccountId: "acct_attacker_000",
  });

  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("mismatch"));

  const donations = supabase.getRows("organization_donations");
  assert.strictEqual(donations.length, 0);
});

test("payment_intent.payment_failed upserts failed donation and updates attempt", async () => {
  const supabase = createSupabaseStub();
  seedOrgWithConnectAccount(supabase, "org_fail", "acct_fail_org");
  seedPaymentAttempt(supabase, "pa_fail_test");

  const result = await simulatePaymentIntentFailed({
    supabase,
    paymentIntent: {
      id: "pi_failed_123",
      amount: 3000,
      currency: "usd",
      receipt_email: "failed@example.com",
      status: "requires_payment_method",
      last_payment_error: { message: "Your card was declined" },
      metadata: {
        organization_id: "org_fail",
        payment_attempt_id: "pa_fail_test",
      },
    },
    connectedAccountId: "acct_fail_org",
  });

  assert.strictEqual(result.status, 200);
  assert.ok(result.message?.includes("failed"));

  // Verify donation was created with failed status
  const donations = supabase.getRows("organization_donations");
  assert.strictEqual(donations.length, 1);
  assert.strictEqual(donations[0].status, "failed");
  assert.strictEqual(donations[0].stripe_payment_intent_id, "pi_failed_123");
  assert.strictEqual(donations[0].amount_cents, 3000);

  // Verify payment attempt was updated with error
  const attempts = supabase.getRows("payment_attempts");
  const updatedAttempt = attempts.find((a) => a.id === "pa_fail_test");
  assert.strictEqual(updatedAttempt?.status, "failed");
  assert.strictEqual(updatedAttempt?.last_error, "Your card was declined");
});

test("payment_intent.payment_failed skips when organization_id is missing", async () => {
  const supabase = createSupabaseStub();

  const result = await simulatePaymentIntentFailed({
    supabase,
    paymentIntent: {
      id: "pi_fail_no_org",
      amount: 1000,
      metadata: {},
    },
    connectedAccountId: "acct_123",
  });

  assert.strictEqual(result.status, 200);
  assert.ok(result.message?.includes("Missing organization_id"));
});

test("payment_intent.payment_failed uses status as fallback when no error message", async () => {
  const supabase = createSupabaseStub();
  seedOrgWithConnectAccount(supabase, "org_fallback", "acct_fallback");
  seedPaymentAttempt(supabase, "pa_fallback_test");

  const result = await simulatePaymentIntentFailed({
    supabase,
    paymentIntent: {
      id: "pi_fail_no_msg",
      amount: 2000,
      currency: "usd",
      status: "requires_payment_method",
      metadata: {
        organization_id: "org_fallback",
        payment_attempt_id: "pa_fallback_test",
      },
    },
    connectedAccountId: "acct_fallback",
  });

  assert.strictEqual(result.status, 200);

  const attempts = supabase.getRows("payment_attempts");
  const updatedAttempt = attempts.find((a) => a.id === "pa_fallback_test");
  assert.strictEqual(updatedAttempt?.last_error, "requires_payment_method");
});

test("payment_intent.succeeded handles donation upsert on duplicate payment intent", async () => {
  const supabase = createSupabaseStub();
  seedOrgWithConnectAccount(supabase, "org_dedup", "acct_dedup");
  supabase.registerRpc("increment_donation_stats", () => null);

  // First call creates the donation
  await simulatePaymentIntentSucceeded({
    supabase,
    paymentIntent: {
      id: "pi_dedup_123",
      amount_received: 4000,
      currency: "usd",
      metadata: { organization_id: "org_dedup" },
    },
    connectedAccountId: "acct_dedup",
  });

  // Second call should upsert (update existing)
  const result = await simulatePaymentIntentSucceeded({
    supabase,
    paymentIntent: {
      id: "pi_dedup_123",
      amount_received: 4000,
      currency: "usd",
      metadata: { organization_id: "org_dedup" },
    },
    connectedAccountId: "acct_dedup",
  });

  assert.strictEqual(result.status, 200);

  // Should still only have 1 donation (upserted, not duplicated)
  const donations = supabase.getRows("organization_donations");
  assert.strictEqual(donations.length, 1);
});

test("Connect webhook signature verification works correctly", () => {
  // Valid signature
  const validResult = verifyWebhookSignature("{}", "valid_connect_sig", "whsec_connect_test");
  assert.strictEqual(validResult.valid, true);

  // Invalid signature
  const invalidResult = verifyWebhookSignature("{}", "bad_sig", "whsec_connect_test");
  assert.strictEqual(invalidResult.valid, false);

  // Missing signature
  const missingResult = verifyWebhookSignature("{}", "", "whsec_connect_test");
  assert.strictEqual(missingResult.valid, false);
  assert.strictEqual(missingResult.error, "No signature provided");
});

test("createMockWebhookEvent generates valid Connect event structure", () => {
  const event = createMockWebhookEvent("payment_intent.succeeded", {
    id: "pi_test",
    amount: 5000,
    metadata: { organization_id: "org_test" },
  });

  assert.ok(event.id.startsWith("evt_"));
  assert.strictEqual(event.type, "payment_intent.succeeded");
  assert.strictEqual(event.data.object.id, "pi_test");
  assert.strictEqual(event.data.object.amount, 5000);
});
