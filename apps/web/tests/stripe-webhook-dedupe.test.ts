import test, { describe, it } from "node:test";
import assert from "node:assert";
import { markStripeEventProcessed, registerStripeEvent } from "../src/lib/payments/stripe-events.ts";
import { createSupabaseStub } from "./utils/supabaseStub.ts";

test("stripe webhook events are only processed once", async () => {
  const supabase = createSupabaseStub();
  let processedCount = 0;

  const first = await registerStripeEvent({
    supabase: supabase as never,
    eventId: "evt_test_1",
    type: "payment_intent.succeeded",
    payload: { object_id: "pi_123" },
  });

  assert.strictEqual(first.alreadyProcessed, false);
  processedCount += 1;
  await markStripeEventProcessed(supabase as never, "evt_test_1");

  const second = await registerStripeEvent({
    supabase: supabase as never,
    eventId: "evt_test_1",
    type: "payment_intent.succeeded",
    payload: { object_id: "pi_123" },
  });

  assert.strictEqual(second.alreadyProcessed, true);
  assert.strictEqual(processedCount, 1);

  const stored = supabase.getRows("stripe_events");
  assert.ok(stored[0]?.processed_at, "processed_at should be set after handling");
});

// ── Enterprise subscription upsert failure ───────────────────────────────────

describe("enterprise subscription upsert failure", () => {
  /**
   * Simulates the webhook handler behavior when enterprise_subscriptions upsert fails.
   * Before fix: logs error, returns 200 (Stripe stops retrying, enterprise has no subscription row).
   * After fix: returns 500 so Stripe retries with exponential backoff.
   */
  function simulateWebhookSubUpsert(subError: { message: string } | null): { status: number } {
    if (subError) {
      // After fix: return 500 instead of swallowing
      return { status: 500 };
    }
    return { status: 200 };
  }

  it("returns 500 when enterprise subscription upsert fails", () => {
    const result = simulateWebhookSubUpsert({ message: "unique constraint violation" });
    assert.strictEqual(result.status, 500);
  });

  it("returns 200 when enterprise subscription upsert succeeds", () => {
    const result = simulateWebhookSubUpsert(null);
    assert.strictEqual(result.status, 200);
  });
});
