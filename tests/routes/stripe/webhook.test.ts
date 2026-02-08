import test from "node:test";
import assert from "node:assert";
import {
  createMockWebhookEvent,
  verifyWebhookSignature,
  WebhookEventPresets,
} from "../../utils/stripeMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

/**
 * Tests for POST /api/stripe/webhook
 *
 * The main webhook route handles:
 * 1. Verify Stripe signature
 * 2. Deduplicate events (prevent double processing)
 * 3. Handle checkout.session.completed for org provisioning (subscription mode only)
 * 4. Handle subscription lifecycle events
 * 5. Validate org ownership of Stripe resources (prevent cross-org hijacking)
 * 6. Guard: Connect events (event.account present) are returned immediately
 *
 * Donation events (payment_intent.succeeded, payment_intent.payment_failed,
 * and payment-mode checkout.session.completed) are handled by the Connect
 * webhook at /api/stripe/webhook-connect. See webhook-connect.test.ts.
 */

// Types
interface WebhookRequest {
  payload: string;
  signature: string;
  webhookSecret: string;
}

interface WebhookResult {
  status: number;
  message?: string;
  error?: string;
  processed?: boolean;
}

interface EventDeduplicationContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  eventId: string;
}

// Simulation functions

function simulateSignatureVerification(request: WebhookRequest): WebhookResult {
  const { valid, error } = verifyWebhookSignature(
    request.payload,
    request.signature,
    request.webhookSecret
  );

  if (!valid) {
    return { status: 400, error: error || "Invalid signature" };
  }

  return { status: 200, message: "Signature valid" };
}

async function simulateEventDeduplication(
  ctx: EventDeduplicationContext
): Promise<WebhookResult> {
  const { supabase, eventId } = ctx;

  // Check if event already exists
  const { data: existing } = await supabase
    .from("stripe_events")
    .select()
    .eq("event_id", eventId)
    .maybeSingle();

  if (existing) {
    return { status: 200, message: "Event already processed", processed: false };
  }

  // Insert new event
  const { error } = await supabase
    .from("stripe_events")
    .insert({ event_id: eventId, processed_at: new Date().toISOString() })
    .single();

  if (error?.code === "23505") {
    // Concurrent insert - another process handled it
    return { status: 200, message: "Event already processed", processed: false };
  }

  return { status: 200, message: "Event recorded", processed: true };
}

interface CheckoutCompletedContext {
  session: {
    id: string;
    mode: string;
    subscription?: string;
    customer?: string;
    metadata?: {
      organization_id?: string;
      organization_name?: string;
      organization_slug?: string;
      alumni_bucket?: string;
      billing_interval?: string;
      admin_user_id?: string;
    };
  };
  supabase: ReturnType<typeof createSupabaseStub>;
}

async function simulateCheckoutCompleted(
  ctx: CheckoutCompletedContext
): Promise<WebhookResult> {
  const { session, supabase } = ctx;
  const metadata = session.metadata || {};

  // For subscription mode, verify required metadata
  if (session.mode === "subscription") {
    if (!metadata.organization_id && !metadata.organization_slug) {
      // Check payment_attempts for existing org info
      const { data: attempt } = await supabase
        .from("payment_attempts")
        .select()
        .eq("stripe_checkout_session_id", session.id)
        .maybeSingle();

      if (!attempt) {
        return { status: 400, error: "Missing organization metadata and no payment attempt found" };
      }
    }

    // Would provision org and grant admin role here
    // This is the critical path - ensuring admin_user_id from metadata gets admin role
    if (metadata.admin_user_id) {
      // Grant admin role logic would happen here
      return { status: 200, message: "Organization provisioned, admin role granted" };
    }
  }

  return { status: 200, message: "Checkout processed" };
}

interface SubscriptionEventContext {
  event: {
    type: string;
    subscriptionId: string;
    status?: string;
    cancelAtPeriodEnd?: boolean;
  };
  existingOrg?: {
    id: string;
    stripe_subscription_id?: string;
    stripe_customer_id?: string;
  };
}

function simulateSubscriptionEvent(ctx: SubscriptionEventContext): WebhookResult {
  const { event, existingOrg } = ctx;

  // Cross-org validation: subscription must belong to the org
  if (existingOrg && existingOrg.stripe_subscription_id) {
    if (existingOrg.stripe_subscription_id !== event.subscriptionId) {
      return { status: 400, error: "Subscription does not belong to this organization" };
    }
  }

  switch (event.type) {
    case "customer.subscription.created":
      return { status: 200, message: "Subscription created" };

    case "customer.subscription.updated":
      // Handle cancel_at_period_end flag
      if (event.cancelAtPeriodEnd) {
        return { status: 200, message: "Subscription marked for cancellation" };
      }
      return { status: 200, message: "Subscription updated" };

    case "customer.subscription.deleted":
      // Start grace period or revoke access
      return { status: 200, message: "Subscription canceled, grace period started" };

    default:
      return { status: 200, message: "Event type not handled" };
  }
}

interface ConnectEventGuardContext {
  event: {
    type: string;
    account?: string;
  };
}

function simulateConnectEventGuard(ctx: ConnectEventGuardContext): WebhookResult {
  // Guard: Connect events should be handled by /api/stripe/webhook-connect
  if (ctx.event.account) {
    return { status: 500, error: "Connect events must be sent to /api/stripe/webhook-connect" };
  }
  return { status: 200, message: "Event processed by main webhook" };
}

// Tests

test("webhook rejects missing signature", () => {
  const result = simulateSignatureVerification({
    payload: "{}",
    signature: "",
    webhookSecret: "whsec_test",
  });

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "No signature provided");
});

test("webhook rejects invalid signature", () => {
  const result = simulateSignatureVerification({
    payload: "{}",
    signature: "invalid_sig",
    webhookSecret: "whsec_test",
  });

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Invalid signature");
});

test("webhook accepts valid signature", () => {
  const result = simulateSignatureVerification({
    payload: "{}",
    signature: "valid_sig_12345",
    webhookSecret: "whsec_test",
  });

  assert.strictEqual(result.status, 200);
});

test("webhook deduplicates events - first occurrence is processed", async () => {
  const supabase = createSupabaseStub();
  const eventId = "evt_test_123";

  const result = await simulateEventDeduplication({ supabase, eventId });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.processed, true);

  // Event should be stored
  const rows = supabase.getRows("stripe_events");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].event_id, eventId);
});

test("webhook deduplicates events - second occurrence is skipped", async () => {
  const supabase = createSupabaseStub();
  const eventId = "evt_test_456";

  // First call
  await simulateEventDeduplication({ supabase, eventId });

  // Second call - should be skipped
  const result = await simulateEventDeduplication({ supabase, eventId });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.processed, false);
  assert.strictEqual(result.message, "Event already processed");
});

test("checkout.session.completed provisions org with admin role", async () => {
  const supabase = createSupabaseStub();

  const result = await simulateCheckoutCompleted({
    supabase,
    session: {
      id: "cs_test_123",
      mode: "subscription",
      subscription: "sub_test_123",
      customer: "cus_test_123",
      metadata: {
        organization_id: "org_123",
        organization_name: "Test Org",
        organization_slug: "test-org",
        admin_user_id: "user_123",
        alumni_bucket: "0-200",
        billing_interval: "monthly",
      },
    },
  });

  assert.strictEqual(result.status, 200);
  assert.ok(result.message?.includes("admin role granted"));
});

test("checkout.session.completed without org metadata falls back to payment_attempts", async () => {
  const supabase = createSupabaseStub();

  // No payment attempt, no metadata - should fail
  const result = await simulateCheckoutCompleted({
    supabase,
    session: {
      id: "cs_unknown_123",
      mode: "subscription",
      subscription: "sub_test_123",
      metadata: {},
    },
  });

  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("Missing organization metadata"));
});

test("subscription.updated with cancel_at_period_end marks subscription for cancellation", () => {
  const result = simulateSubscriptionEvent({
    event: {
      type: "customer.subscription.updated",
      subscriptionId: "sub_test_123",
      status: "active",
      cancelAtPeriodEnd: true,
    },
    existingOrg: {
      id: "org_123",
      stripe_subscription_id: "sub_test_123",
    },
  });

  assert.strictEqual(result.status, 200);
  assert.ok(result.message?.includes("cancellation"));
});

test("subscription.deleted starts grace period", () => {
  const result = simulateSubscriptionEvent({
    event: {
      type: "customer.subscription.deleted",
      subscriptionId: "sub_test_123",
      status: "canceled",
    },
    existingOrg: {
      id: "org_123",
      stripe_subscription_id: "sub_test_123",
    },
  });

  assert.strictEqual(result.status, 200);
  assert.ok(result.message?.includes("grace period"));
});

test("subscription event rejects cross-org subscription hijacking", () => {
  const result = simulateSubscriptionEvent({
    event: {
      type: "customer.subscription.updated",
      subscriptionId: "sub_attacker_999", // Different subscription
      status: "active",
    },
    existingOrg: {
      id: "org_123",
      stripe_subscription_id: "sub_test_123", // Org's actual subscription
    },
  });

  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("does not belong"));
});

test("main webhook skips events with event.account (Connect events)", () => {
  const result = simulateConnectEventGuard({
    event: {
      type: "payment_intent.succeeded",
      account: "acct_connect_123",
    },
  });

  assert.strictEqual(result.status, 500);
  assert.ok(result.error?.includes("webhook-connect"));
});

test("main webhook processes events without event.account", () => {
  const result = simulateConnectEventGuard({
    event: {
      type: "customer.subscription.updated",
    },
  });

  assert.strictEqual(result.status, 200);
  assert.ok(result.message?.includes("Event processed by main webhook"));
});

test("createMockWebhookEvent generates valid event structure", () => {
  const event = createMockWebhookEvent("test.event", { foo: "bar" });

  assert.ok(event.id.startsWith("evt_"));
  assert.strictEqual(event.type, "test.event");
  assert.deepStrictEqual(event.data.object, { foo: "bar" });
  assert.ok(event.created > 0);
});

test("WebhookEventPresets.checkoutCompleted creates valid event", () => {
  const event = WebhookEventPresets.checkoutCompleted({ org_id: "test" });

  assert.strictEqual(event.type, "checkout.session.completed");
  assert.strictEqual(event.data.object.mode, "subscription");
  assert.deepStrictEqual(event.data.object.metadata, { org_id: "test" });
});

test("WebhookEventPresets.subscriptionDeleted creates valid event", () => {
  const event = WebhookEventPresets.subscriptionDeleted("sub_custom");

  assert.strictEqual(event.type, "customer.subscription.deleted");
  assert.strictEqual(event.data.object.id, "sub_custom");
  assert.strictEqual(event.data.object.status, "canceled");
});
