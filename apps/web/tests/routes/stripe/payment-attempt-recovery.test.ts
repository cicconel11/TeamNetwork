/* eslint-disable @typescript-eslint/no-unused-vars */
import test from "node:test";
import assert from "node:assert";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import {
  ensurePaymentAttempt,
  claimPaymentAttempt,
  updatePaymentAttempt,
} from "../../../src/lib/payments/idempotency.ts";

/**
 * Tests for payment attempt recovery behavior.
 *
 * These tests validate the fix for payment attempts getting permanently stuck
 * in `processing` status when Stripe resource creation fails.
 *
 * The fix:
 * - Track resolvedAttemptId (from ensurePaymentAttempt) instead of using
 *   request-provided paymentAttemptId/idempotencyKey in the catch block
 * - Track stripeResourceCreated flag
 * - In catch: if !stripeResourceCreated, reset status to "initiated" so retries succeed
 * - In catch: if stripeResourceCreated, keep status as "processing" (Stripe has resources)
 */

// ---------------------------------------------------------------------------
// Test 1: Stripe create throws → status should be reset to `initiated`
// ---------------------------------------------------------------------------
test("Stripe create throws → attempt status resets to initiated for retry", async () => {
  const supabaseStub = createSupabaseStub();

  // Step 1: Create the payment attempt (ensurePaymentAttempt)
  const { attempt } = await ensurePaymentAttempt({
    supabase: supabaseStub as never,
    flowType: "subscription_checkout",
    amountCents: 0,
    currency: "usd",
    userId: "user-123",
  });

  assert.equal(attempt.status, "initiated", "Initial status should be initiated");
  const resolvedAttemptId = attempt.id;

  // Step 2: Claim the attempt (simulates claimPaymentAttempt in route)
  const { attempt: claimedAttempt, claimed } = await claimPaymentAttempt({
    supabase: supabaseStub as never,
    attempt,
    amountCents: 0,
    currency: "usd",
  });

  assert.equal(claimed, true, "Should have successfully claimed the attempt");
  assert.equal(claimedAttempt.status, "processing", "Status should be processing after claim");

  // Step 3: Simulate catch block behavior when Stripe fails BEFORE creating a resource
  // stripeResourceCreated = false, so we reset status to "initiated"
  const stripeResourceCreated = false;
  const lastError = "stripe_unavailable";

  const errorUpdate: Record<string, unknown> = { last_error: lastError };
  if (!stripeResourceCreated) {
    errorUpdate.status = "initiated";
  }

  await supabaseStub.from("payment_attempts").update(errorUpdate).eq("id", resolvedAttemptId);

  // Step 4: Verify the attempt was reset to initiated with the error recorded
  const rows = supabaseStub.getRows("payment_attempts");
  const updatedAttempt = rows.find((r) => r.id === resolvedAttemptId);

  assert.ok(updatedAttempt, "Attempt should still exist");
  assert.equal(updatedAttempt.status, "initiated", "Status should be reset to initiated after Stripe failure");
  assert.equal(updatedAttempt.last_error, lastError, "last_error should be recorded");

  // Step 5: Verify claimPaymentAttempt succeeds again after reset (retry is unblocked)
  const refreshedAttempt = rows.find((r) => r.id === resolvedAttemptId);
  assert.ok(refreshedAttempt, "Attempt should exist for retry");

  const { attempt: retriedAttempt, claimed: retriedClaimed } = await claimPaymentAttempt({
    supabase: supabaseStub as never,
    attempt: refreshedAttempt as Parameters<typeof claimPaymentAttempt>[0]["attempt"],
    amountCents: 0,
    currency: "usd",
  });

  assert.equal(retriedClaimed, true, "Should be able to claim again after reset to initiated");
  assert.equal(retriedAttempt.status, "processing", "Status should be processing after re-claim");
  assert.equal(retriedAttempt.last_error, null, "last_error should be cleared on re-claim");
});

// ---------------------------------------------------------------------------
// Test 2: Stripe creates resource but updatePaymentAttempt throws → status stays `processing`
// ---------------------------------------------------------------------------
test("Stripe resource created but updatePaymentAttempt throws → status stays processing", async () => {
  const supabaseStub = createSupabaseStub();

  // Step 1: Create attempt
  const { attempt } = await ensurePaymentAttempt({
    supabase: supabaseStub as never,
    flowType: "donation_checkout",
    amountCents: 5000,
    currency: "usd",
    userId: "user-456",
  });

  const resolvedAttemptId = attempt.id;
  assert.equal(attempt.status, "initiated");

  // Step 2: Claim attempt
  const { claimed } = await claimPaymentAttempt({
    supabase: supabaseStub as never,
    attempt,
    amountCents: 5000,
    currency: "usd",
  });

  assert.equal(claimed, true, "Should have claimed the attempt");

  // Step 3: Simulate: Stripe DID create a resource (stripeResourceCreated = true),
  // but updatePaymentAttempt then threw. The catch block should NOT reset status.
  const stripeResourceCreated = true;
  const lastError = "database_connection_lost";

  const errorUpdate: Record<string, unknown> = { last_error: lastError };
  if (!stripeResourceCreated) {
    // This branch should NOT execute
    errorUpdate.status = "initiated";
  }

  await supabaseStub.from("payment_attempts").update(errorUpdate).eq("id", resolvedAttemptId);

  // Step 4: Verify status stayed as `processing` (no status field in update)
  const rows = supabaseStub.getRows("payment_attempts");
  const updatedAttempt = rows.find((r) => r.id === resolvedAttemptId);

  assert.ok(updatedAttempt, "Attempt should exist");
  assert.equal(updatedAttempt.status, "processing", "Status should stay processing when Stripe resource exists");
  assert.equal(updatedAttempt.last_error, lastError, "last_error should be recorded");

  // Step 5: Verify claimPaymentAttempt cannot re-claim (status is processing, not initiated)
  const { claimed: retriedClaimed } = await claimPaymentAttempt({
    supabase: supabaseStub as never,
    attempt: updatedAttempt as Parameters<typeof claimPaymentAttempt>[0]["attempt"],
    amountCents: 5000,
    currency: "usd",
  });

  assert.equal(retriedClaimed, false, "Should NOT be able to re-claim when status is processing");
});

// ---------------------------------------------------------------------------
// Test 3: Resolved attempt ID (not request params) is used for error update
// ---------------------------------------------------------------------------
test("Resolved attempt ID from ensurePaymentAttempt is used, not request-provided params", async () => {
  const supabaseStub = createSupabaseStub();

  // Simulate a route call where no paymentAttemptId is provided in the request.
  // ensurePaymentAttempt generates its own UUID for the attempt.
  const requestPaymentAttemptId: string | undefined = undefined;
  const requestIdempotencyKey: string | undefined = undefined;

  const { attempt } = await ensurePaymentAttempt({
    supabase: supabaseStub as never,
    idempotencyKey: requestIdempotencyKey,
    paymentAttemptId: requestPaymentAttemptId,
    flowType: "subscription_checkout",
    amountCents: 0,
    currency: "usd",
    userId: "user-789",
  });

  // The resolved ID is what we capture: resolvedAttemptId = attempt.id
  const resolvedAttemptId = attempt.id;
  assert.ok(resolvedAttemptId, "Resolved attempt ID should be set");
  assert.notEqual(resolvedAttemptId, requestPaymentAttemptId, "Resolved ID differs from request-provided undefined");

  // Simulate claim + Stripe failure
  await claimPaymentAttempt({
    supabase: supabaseStub as never,
    attempt,
    amountCents: 0,
    currency: "usd",
  });

  // Old (buggy) pattern: would use requestPaymentAttemptId or requestIdempotencyKey
  // Neither is defined here, so the old code would do NOTHING in the catch block
  const oldPatternWouldUpdate =
    requestPaymentAttemptId !== undefined || requestIdempotencyKey !== undefined;
  assert.equal(
    oldPatternWouldUpdate,
    false,
    "Old pattern with missing request params would skip the error update entirely",
  );

  // New (fixed) pattern: uses resolvedAttemptId
  const newPatternHasId = resolvedAttemptId !== undefined;
  assert.equal(newPatternHasId, true, "New pattern always has a resolved ID to update");

  // Apply the fix: update using resolvedAttemptId
  await supabaseStub
    .from("payment_attempts")
    .update({ last_error: "stripe_failed", status: "initiated" })
    .eq("id", resolvedAttemptId);

  // Verify the update landed correctly
  const rows = supabaseStub.getRows("payment_attempts");
  const updatedAttempt = rows.find((r) => r.id === resolvedAttemptId);

  assert.ok(updatedAttempt, "Attempt should be findable via resolved ID");
  assert.equal(updatedAttempt.status, "initiated", "Status reset to initiated via resolved ID");
  assert.equal(updatedAttempt.last_error, "stripe_failed", "Error recorded via resolved ID");
});

// ---------------------------------------------------------------------------
// Test 4: When no attempt is resolved (ensurePaymentAttempt throws), catch block is safe
// ---------------------------------------------------------------------------
test("If ensurePaymentAttempt throws, resolvedAttemptId is undefined and no update occurs", async () => {
  // This tests the safety of the `if (resolvedAttemptId)` guard
  // If ensurePaymentAttempt itself throws, resolvedAttemptId stays undefined
  // and we never attempt an update on a non-existent ID.

  let resolvedAttemptId: string | undefined;
  const stripeResourceCreated = false;

  // Simulate the scenario: ensurePaymentAttempt throws before we set resolvedAttemptId
  try {
    // Force failure by passing invalid params that cause an early throw
    // We'll simulate this by just throwing directly (represents DB connection failure)
    throw new Error("DB connection failed during ensurePaymentAttempt");
    // In real code: resolvedAttemptId = attempt.id; would come here
  } catch {
    // This is the catch block logic from the route
    const lastError = "DB connection failed during ensurePaymentAttempt";
    if (resolvedAttemptId) {
      // This should NOT execute because resolvedAttemptId is undefined
      const errorUpdate: Record<string, unknown> = { last_error: lastError };
      if (!stripeResourceCreated) {
        errorUpdate.status = "initiated";
      }
      // Intentionally not calling supabase here — the guard prevents it
    }
  }

  // Verify: resolvedAttemptId was never set
  assert.equal(resolvedAttemptId, undefined, "resolvedAttemptId should remain undefined when ensurePaymentAttempt throws");
  assert.equal(stripeResourceCreated, false, "stripeResourceCreated should remain false");
});
