import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import { updatePaymentAttemptStatus } from "../../../src/lib/payments/webhook-handlers.ts";

function readSource(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), relative), "utf8");
}

/**
 * Behavioural test: updatePaymentAttemptStatus's new metadataPatch
 * JSONB-merges into existing metadata without clobbering other keys.
 */
test("updatePaymentAttemptStatus merges metadataPatch into existing metadata", async () => {
  const supabase = createSupabaseStub();

  const { data: inserted } = await supabase
    .from("payment_attempts")
    .insert({
      idempotency_key: "ent-webhook-finalize-key",
      flow_type: "enterprise_checkout",
      amount_cents: 0,
      currency: "usd",
      status: "processing",
      user_id: "user-1",
      organization_id: null,
      metadata: {
        pending_enterprise_id: "ent-pending-uuid",
        slug: "acme",
      },
    })
    .select()
    .single();

  assert.ok(inserted);

  const { error } = await updatePaymentAttemptStatus(supabase as never, {
    paymentAttemptId: inserted.id,
    status: "succeeded",
    checkoutSessionId: "cs_test_ent",
    metadataPatch: { provisioned_enterprise_id: "ent-real-uuid" },
  });
  assert.equal(error, null);

  const { data: after } = await supabase
    .from("payment_attempts")
    .select("*")
    .eq("id", inserted.id)
    .maybeSingle();

  assert.ok(after);
  assert.equal(after.status, "succeeded");
  assert.equal(after.stripe_checkout_session_id, "cs_test_ent");
  const metadata = after.metadata as Record<string, unknown>;
  assert.equal(metadata.pending_enterprise_id, "ent-pending-uuid");
  assert.equal(metadata.slug, "acme");
  assert.equal(metadata.provisioned_enterprise_id, "ent-real-uuid");
});

/**
 * Wiring tests: verify the webhook handler's enterprise branch threads
 * payment_attempt_id through the happy path and the failure paths.
 */
test("enterprise webhook branch reads payment_attempt_id from session metadata", () => {
  const source = readSource("src/app/api/stripe/webhook/handler.ts");
  const entBranch = source.slice(
    source.indexOf('session.metadata?.type === "enterprise"'),
    source.indexOf("if (session.mode === \"subscription\" || subscriptionId)"),
  );
  assert.match(entBranch, /const enterprisePaymentAttemptId =\s*\n\s*\(session\.metadata\?\.payment_attempt_id as string \| undefined\) \?\? null;/);
});

test("enterprise webhook branch short-circuits when attempt already succeeded", () => {
  const source = readSource("src/app/api/stripe/webhook/handler.ts");
  const entBranch = source.slice(
    source.indexOf('session.metadata?.type === "enterprise"'),
    source.indexOf("if (session.mode === \"subscription\" || subscriptionId)"),
  );
  assert.match(entBranch, /if \(priorAttempt\?\.status === "succeeded"\)/);
});

test("enterprise webhook branch marks attempt succeeded with provisioned_enterprise_id patch", () => {
  const source = readSource("src/app/api/stripe/webhook/handler.ts");
  const entBranch = source.slice(
    source.indexOf('session.metadata?.type === "enterprise"'),
    source.indexOf("if (session.mode === \"subscription\" || subscriptionId)"),
  );
  assert.match(entBranch, /status: "succeeded"/);
  assert.match(entBranch, /metadataPatch: \{ provisioned_enterprise_id: enterprise\.id \}/);
});

test("enterprise webhook branch marks attempt failed on insert errors", () => {
  const source = readSource("src/app/api/stripe/webhook/handler.ts");
  const entBranch = source.slice(
    source.indexOf('session.metadata?.type === "enterprise"'),
    source.indexOf("if (session.mode === \"subscription\" || subscriptionId)"),
  );
  const failedOccurrences = entBranch.match(/status: "failed"/g) || [];
  assert.ok(
    failedOccurrences.length >= 2,
    `expected multiple failure paths to mark attempt failed, got ${failedOccurrences.length}`,
  );
});

test("enterprise checkout route calls ensure/claim/update and catches IdempotencyConflictError", () => {
  const source = readSource("src/app/api/stripe/create-enterprise-checkout/route.ts");
  assert.match(source, /ensurePaymentAttempt\(/);
  assert.match(source, /claimPaymentAttempt\(/);
  assert.match(source, /updatePaymentAttempt\(/);
  assert.match(source, /IdempotencyConflictError/);
  assert.match(source, /flowType: "enterprise_checkout"/);
  assert.match(source, /idempotencyKey: claimedAttempt\.idempotency_key/);
});
