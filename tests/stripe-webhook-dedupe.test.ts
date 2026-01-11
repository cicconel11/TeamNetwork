import test from "node:test";
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
