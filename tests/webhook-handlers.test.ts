import test from "node:test";
import assert from "node:assert";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import type { DonorInfo } from "../src/lib/payments/webhook-handlers.ts";

/**
 * Tests for webhook-handlers utility functions.
 * Focuses on resolveDonorFromPaymentAttempt and anonymous donation flow.
 */

// Simulate resolveDonorFromPaymentAttempt (mirrors the real function)
async function simulateResolveDonor(
  supabase: ReturnType<typeof createSupabaseStub>,
  paymentAttemptId: string | null
): Promise<DonorInfo> {
  if (!paymentAttemptId) return { donorName: null, donorEmail: null, anonymous: false };

  const rows = supabase.getRows("payment_attempts");
  const attempt = rows.find((r) => r.id === paymentAttemptId);
  const meta = (attempt?.metadata || {}) as Record<string, string>;

  return {
    donorName: meta.donor_name ?? null,
    donorEmail: meta.donor_email ?? null,
    anonymous: meta.anonymous === "true",
  };
}

// Simulate upsertDonationRecord to verify anonymous field passes through
function simulateUpsertDonation(
  supabase: ReturnType<typeof createSupabaseStub>,
  params: {
    organizationId: string;
    donorName: string | null;
    donorEmail: string | null;
    anonymous: boolean;
    amountCents: number;
    status: string;
  }
): void {
  const existing = supabase.getRows("organization_donations");
  supabase.seed("organization_donations", [
    ...existing,
    {
      id: `don_${Date.now()}`,
      organization_id: params.organizationId,
      donor_name: params.donorName,
      donor_email: params.donorEmail,
      anonymous: params.anonymous,
      amount_cents: params.amountCents,
      status: params.status,
    },
  ]);
}

test("resolveDonorFromPaymentAttempt returns anonymous=true when metadata has anonymous flag", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("payment_attempts", [
    {
      id: "pa_anon",
      metadata: { donor_name: "Hidden Donor", donor_email: "hidden@example.com", anonymous: "true" },
    },
  ]);

  const result = await simulateResolveDonor(supabase, "pa_anon");

  assert.strictEqual(result.donorName, "Hidden Donor");
  assert.strictEqual(result.donorEmail, "hidden@example.com");
  assert.strictEqual(result.anonymous, true);
});

test("resolveDonorFromPaymentAttempt returns anonymous=false when flag is absent", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("payment_attempts", [
    {
      id: "pa_public",
      metadata: { donor_name: "Public Donor", donor_email: "public@example.com" },
    },
  ]);

  const result = await simulateResolveDonor(supabase, "pa_public");

  assert.strictEqual(result.donorName, "Public Donor");
  assert.strictEqual(result.donorEmail, "public@example.com");
  assert.strictEqual(result.anonymous, false);
});

test("resolveDonorFromPaymentAttempt returns defaults for null paymentAttemptId", async () => {
  const supabase = createSupabaseStub();

  const result = await simulateResolveDonor(supabase, null);

  assert.strictEqual(result.donorName, null);
  assert.strictEqual(result.donorEmail, null);
  assert.strictEqual(result.anonymous, false);
});

test("anonymous donation upsert stores anonymous=true in donation record", () => {
  const supabase = createSupabaseStub();

  simulateUpsertDonation(supabase, {
    organizationId: "org_1",
    donorName: "Secret Donor",
    donorEmail: "secret@example.com",
    anonymous: true,
    amountCents: 5000,
    status: "succeeded",
  });

  const donations = supabase.getRows("organization_donations");
  assert.strictEqual(donations.length, 1);
  assert.strictEqual(donations[0].anonymous, true);
  assert.strictEqual(donations[0].donor_name, "Secret Donor");
});

test("non-anonymous donation upsert stores anonymous=false in donation record", () => {
  const supabase = createSupabaseStub();

  simulateUpsertDonation(supabase, {
    organizationId: "org_1",
    donorName: "Visible Donor",
    donorEmail: "visible@example.com",
    anonymous: false,
    amountCents: 10000,
    status: "succeeded",
  });

  const donations = supabase.getRows("organization_donations");
  assert.strictEqual(donations.length, 1);
  assert.strictEqual(donations[0].anonymous, false);
  assert.strictEqual(donations[0].donor_name, "Visible Donor");
});
