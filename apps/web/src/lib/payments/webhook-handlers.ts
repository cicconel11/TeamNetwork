import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { Database } from "@/types/database";

type DbClient = SupabaseClient<Database, "public">;

export type DonationInsert = Database["public"]["Tables"]["organization_donations"]["Insert"];
export type DonorInfo = { donorName: string | null; donorEmail: string | null; anonymous: boolean };

export type UpsertDonationParams = {
  organizationId: string;
  paymentIntentId?: string | null;
  checkoutSessionId?: string | null;
  amountCents: number;
  currency?: string | null;
  donorName?: string | null;
  donorEmail?: string | null;
  anonymous?: boolean;
  eventId?: string | null;
  purpose?: string | null;
  metadata?: Stripe.Metadata | null;
  status: string;
};

export async function upsertDonationRecord(
  supabase: DbClient,
  params: UpsertDonationParams
): Promise<{ error: PostgrestError | null }> {
  const payload: DonationInsert = {
    organization_id: params.organizationId,
    stripe_payment_intent_id: params.paymentIntentId ?? null,
    stripe_checkout_session_id: params.checkoutSessionId ?? null,
    amount_cents: params.amountCents,
    currency: (params.currency ?? "usd").toLowerCase(),
    donor_name: params.donorName ?? null,
    donor_email: params.donorEmail ?? null,
    event_id: params.eventId ?? null,
    purpose: params.purpose ?? null,
    metadata: params.metadata ?? null,
    status: params.status,
  };

  // anonymous column added via migration but not yet in generated types
  (payload as Record<string, unknown>).anonymous = params.anonymous ?? false;
  if (params.anonymous) {
    (payload as Record<string, unknown>).visibility = "private";
  }

  const conflictTarget = payload.stripe_payment_intent_id
    ? "stripe_payment_intent_id"
    : payload.stripe_checkout_session_id
      ? "stripe_checkout_session_id"
      : undefined;

  const query = conflictTarget
    ? supabase.from("organization_donations").upsert(payload, { onConflict: conflictTarget })
    : supabase.from("organization_donations").insert(payload);

  const { error } = await query;
  return { error };
}

export async function incrementDonationStats(
  supabase: DbClient,
  organizationId: string,
  amountCents: number,
  occurredAt: string | null,
  countDelta = 1
): Promise<{ error: PostgrestError | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("increment_donation_stats", {
    p_org_id: organizationId,
    p_amount_delta: amountCents,
    p_count_delta: countDelta,
    p_last: occurredAt ?? new Date().toISOString(),
  });
  return { error };
}

export async function updatePaymentAttemptStatus(
  supabase: DbClient,
  params: {
    paymentAttemptId?: string | null;
    paymentIntentId?: string | null;
    checkoutSessionId?: string | null;
    status?: string;
    lastError?: string | null;
    organizationId?: string | null;
    stripeConnectedAccountId?: string | null;
    metadataPatch?: Record<string, unknown> | null;
  }
): Promise<{ error: PostgrestError | null }> {
  // JSONB-merge a partial metadata patch into the existing metadata when
  // requested. Done as a read-then-merge to keep the call site ergonomic;
  // payment_attempts rows are written by one attempt at a time post-claim,
  // so this is race-safe for enterprise finalization.
  let mergedMetadata: Record<string, unknown> | undefined;
  if (params.metadataPatch && Object.keys(params.metadataPatch).length > 0) {
    let lookup = supabase.from("payment_attempts").select("metadata");
    if (params.paymentAttemptId) {
      lookup = lookup.eq("id", params.paymentAttemptId);
    } else if (params.paymentIntentId) {
      lookup = lookup.eq("stripe_payment_intent_id", params.paymentIntentId);
    } else if (params.checkoutSessionId) {
      lookup = lookup.eq("stripe_checkout_session_id", params.checkoutSessionId);
    }
    const { data: existing } = await lookup.maybeSingle();
    const base = (existing?.metadata as Record<string, unknown> | null) ?? {};
    mergedMetadata = { ...base, ...params.metadataPatch };
  }

  const payload: Database["public"]["Tables"]["payment_attempts"]["Update"] = {
    updated_at: new Date().toISOString(),
    ...(typeof params.status === "string" && { status: params.status }),
    ...(params.lastError !== undefined && { last_error: params.lastError }),
    ...(params.paymentIntentId !== undefined && { stripe_payment_intent_id: params.paymentIntentId }),
    ...(params.checkoutSessionId !== undefined && { stripe_checkout_session_id: params.checkoutSessionId }),
    ...(params.organizationId !== undefined && { organization_id: params.organizationId }),
    ...(params.stripeConnectedAccountId !== undefined && { stripe_connected_account_id: params.stripeConnectedAccountId }),
    ...(mergedMetadata !== undefined && {
      metadata: mergedMetadata as Database["public"]["Tables"]["payment_attempts"]["Update"]["metadata"],
    }),
  };

  let query = supabase.from("payment_attempts").update(payload);
  if (params.paymentAttemptId) {
    query = query.eq("id", params.paymentAttemptId);
  } else if (params.paymentIntentId) {
    query = query.eq("stripe_payment_intent_id", params.paymentIntentId);
  } else if (params.checkoutSessionId) {
    query = query.eq("stripe_checkout_session_id", params.checkoutSessionId);
  } else {
    return { error: null };
  }

  const { error } = await query;
  if (error) {
    console.error("[webhook-handlers] Failed to update payment_attempt", error);
  }
  return { error };
}

export async function resolveDonorFromPaymentAttempt(
  supabase: DbClient,
  paymentAttemptId: string | null
): Promise<DonorInfo> {
  if (!paymentAttemptId) return { donorName: null, donorEmail: null, anonymous: false };

  const { data, error } = await supabase
    .from("payment_attempts")
    .select("metadata")
    .eq("id", paymentAttemptId)
    .maybeSingle();

  if (error) {
    throw new Error(`[resolveDonorFromPaymentAttempt] DB query failed: ${error.message}`);
  }

  const meta = data?.metadata as Record<string, string> | null;
  return {
    donorName: meta?.donor_name ?? null,
    donorEmail: meta?.donor_email ?? null,
    anonymous: meta?.anonymous === "true",
  };
}

export const extractAccountId = (value: string | Stripe.Account | null | undefined): string | null =>
  typeof value === "string" ? value : value?.id || null;
