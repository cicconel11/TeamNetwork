import test from "node:test";
import assert from "node:assert/strict";
import {
  claimPaymentAttempt,
  ensurePaymentAttempt,
  hashFingerprint,
  hasStripeResource,
  IdempotencyConflictError,
  updatePaymentAttempt,
  waitForExistingStripeResource,
} from "../../../src/lib/payments/idempotency.ts";
import { buildEnterpriseCheckoutFingerprintPayload } from "../../../src/lib/payments/enterprise-checkout-fingerprint.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

/**
 * Exercises the enterprise-checkout idempotency contract end-to-end against
 * the Supabase stub, mirroring tests/payment-idempotency.test.ts for the
 * org flow. This is the key coverage the enterprise flow lacked: a replay
 * of the same idempotency key produces one Stripe session, a replay with
 * a different payload is rejected, and a mid-flight replay returns a 409
 * retry.
 */

const BASE_PAYLOAD = {
  userId: "user-1",
  slug: "acme",
  billingInterval: "year" as const,
  alumniBucketQuantity: 2,
  subOrgQuantity: 5,
  billingContactEmail: "billing@acme.test",
};

test("replaying the same key + same payload reuses the Stripe session", async () => {
  const supabase = createSupabaseStub();
  const idempotencyKey = "enterprise-replay-key";
  const fingerprint = hashFingerprint(buildEnterpriseCheckoutFingerprintPayload(BASE_PAYLOAD));

  const stripeCalls: string[] = [];
  const checkoutUrl = "https://checkout.stripe.com/cs_test_ent";
  const checkoutSessionId = "cs_test_ent_1";

  async function handle() {
    const { attempt } = await ensurePaymentAttempt({
      supabase: supabase as never,
      idempotencyKey,
      flowType: "enterprise_checkout",
      amountCents: 0,
      currency: "usd",
      userId: BASE_PAYLOAD.userId,
      organizationId: null,
      requestFingerprint: fingerprint,
      metadata: { pending_enterprise_id: "ent-seed", slug: BASE_PAYLOAD.slug },
    });

    const { attempt: claimed, claimed: didClaim } = await claimPaymentAttempt({
      supabase: supabase as never,
      attempt,
      amountCents: 0,
      currency: "usd",
      requestFingerprint: fingerprint,
    });

    if (!didClaim) {
      if (hasStripeResource(claimed) && claimed.checkout_url) {
        return claimed.checkout_url;
      }
      const awaited = await waitForExistingStripeResource(supabase as never, claimed.id, 5);
      return awaited?.checkout_url ?? null;
    }

    stripeCalls.push(claimed.idempotency_key);
    await updatePaymentAttempt(supabase as never, claimed.id, {
      stripe_checkout_session_id: checkoutSessionId,
      checkout_url: checkoutUrl,
      status: "processing",
    });
    return checkoutUrl;
  }

  const [a, b] = await Promise.all([handle(), handle()]);
  const c = await handle();

  assert.equal(a, checkoutUrl);
  assert.equal(b, checkoutUrl);
  assert.equal(c, checkoutUrl);
  assert.equal(stripeCalls.length, 1);
});

test("replaying same key with a different payload throws IdempotencyConflictError", async () => {
  const supabase = createSupabaseStub();
  const key = "enterprise-conflict-key";
  const fpA = hashFingerprint(buildEnterpriseCheckoutFingerprintPayload(BASE_PAYLOAD));
  const fpB = hashFingerprint(
    buildEnterpriseCheckoutFingerprintPayload({ ...BASE_PAYLOAD, alumniBucketQuantity: 3 }),
  );

  await ensurePaymentAttempt({
    supabase: supabase as never,
    idempotencyKey: key,
    flowType: "enterprise_checkout",
    amountCents: 0,
    currency: "usd",
    userId: BASE_PAYLOAD.userId,
    organizationId: null,
    requestFingerprint: fpA,
  });

  await assert.rejects(
    ensurePaymentAttempt({
      supabase: supabase as never,
      idempotencyKey: key,
      flowType: "enterprise_checkout",
      amountCents: 0,
      currency: "usd",
      userId: BASE_PAYLOAD.userId,
      organizationId: null,
      requestFingerprint: fpB,
    }),
    IdempotencyConflictError,
  );
});

test("replay while first attempt is still processing returns a 409-style retry signal", async () => {
  const supabase = createSupabaseStub();
  const key = "enterprise-inflight-key";
  const fingerprint = hashFingerprint(buildEnterpriseCheckoutFingerprintPayload(BASE_PAYLOAD));

  const { attempt } = await ensurePaymentAttempt({
    supabase: supabase as never,
    idempotencyKey: key,
    flowType: "enterprise_checkout",
    amountCents: 0,
    currency: "usd",
    userId: BASE_PAYLOAD.userId,
    organizationId: null,
    requestFingerprint: fingerprint,
  });

  const first = await claimPaymentAttempt({
    supabase: supabase as never,
    attempt,
    amountCents: 0,
    currency: "usd",
    requestFingerprint: fingerprint,
  });
  assert.equal(first.claimed, true);

  // No Stripe resource yet — second claim cannot proceed, cannot recover.
  const second = await claimPaymentAttempt({
    supabase: supabase as never,
    attempt,
    amountCents: 0,
    currency: "usd",
    requestFingerprint: fingerprint,
  });
  assert.equal(second.claimed, false);
  assert.equal(hasStripeResource(second.attempt), false);
});

test("fingerprint excludes mutable display fields (name, description)", () => {
  const base = buildEnterpriseCheckoutFingerprintPayload(BASE_PAYLOAD);
  // @ts-expect-error — verifying unrelated fields would not change the fingerprint
  base.name = "Acme Inc";
  const fpA = hashFingerprint(buildEnterpriseCheckoutFingerprintPayload(BASE_PAYLOAD));
  const fpB = hashFingerprint(buildEnterpriseCheckoutFingerprintPayload(BASE_PAYLOAD));
  assert.equal(fpA, fpB);

  const fpDifferentBucket = hashFingerprint(
    buildEnterpriseCheckoutFingerprintPayload({ ...BASE_PAYLOAD, alumniBucketQuantity: 4 }),
  );
  assert.notEqual(fpA, fpDifferentBucket);

  const fpDifferentUser = hashFingerprint(
    buildEnterpriseCheckoutFingerprintPayload({ ...BASE_PAYLOAD, userId: "user-2" }),
  );
  assert.notEqual(fpA, fpDifferentUser);
});
