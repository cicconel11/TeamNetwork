import test from "node:test";
import assert from "node:assert";
import {
  claimPaymentAttempt,
  ensurePaymentAttempt,
  updatePaymentAttempt,
  waitForExistingStripeResource,
} from "../src/lib/payments/idempotency";
import { createSupabaseStub } from "./utils/supabaseStub";

test("concurrent donation checkout requests reuse the same Stripe session", async () => {
  const supabase = createSupabaseStub();
  const idempotencyKey = "demo-checkout-key";
  const stripeCalls: string[] = [];
  const checkoutUrl = "https://checkout.stripe.com/test_cs";
  const checkoutSessionId = "cs_test_123";

  async function handleRequest() {
    const { attempt } = await ensurePaymentAttempt({
      supabase: supabase as never,
      idempotencyKey,
      flowType: "donation_checkout",
      amountCents: 5000,
      currency: "usd",
      organizationId: "org-1",
      requestFingerprint: "fingerprint",
    });

    const { attempt: claimedAttempt, claimed } = await claimPaymentAttempt({
      supabase: supabase as never,
      attempt,
      amountCents: 5000,
      currency: "usd",
      requestFingerprint: "fingerprint",
    });

    if (!claimed) {
      const deadline = Date.now() + 250;
      while (Date.now() < deadline) {
        const awaited = await waitForExistingStripeResource(supabase as never, claimedAttempt.id, 5);
        if (awaited?.checkout_url) {
          return awaited.checkout_url;
        }
      }
      return claimedAttempt.checkout_url;
    }

    stripeCalls.push(claimedAttempt.idempotency_key);
    await updatePaymentAttempt(supabase as never, claimedAttempt.id, {
      stripe_checkout_session_id: checkoutSessionId,
      checkout_url: checkoutUrl,
      status: "processing",
    });

    return checkoutUrl;
  }

  const [first, second] = await Promise.all([handleRequest(), handleRequest()]);
  const third = await handleRequest();

  assert.strictEqual(first, checkoutUrl);
  assert.strictEqual(second, checkoutUrl);
  assert.strictEqual(third, checkoutUrl);
  assert.strictEqual(stripeCalls.length, 1);
});
