import { createHash, randomUUID } from "crypto";
import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type DbClient = SupabaseClient<Database, "public">;
export type PaymentAttempt = Database["public"]["Tables"]["payment_attempts"]["Row"];
export type PaymentAttemptInsert = Database["public"]["Tables"]["payment_attempts"]["Insert"];
export type PaymentAttemptUpdate = Database["public"]["Tables"]["payment_attempts"]["Update"];

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export class PaymentAttemptNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentAttemptNotFoundError";
  }
}

const UNIQUE_VIOLATION = "23505";

export function normalizeIdempotencyKey(key?: string | null, fallback?: string) {
  return (key || fallback || randomUUID()).trim();
}

export function hashFingerprint(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload ?? {})).digest("hex");
}

export function normalizeCurrency(currency?: string | null) {
  return (currency || "usd").toLowerCase();
}

export function hasStripeResource(attempt: PaymentAttempt) {
  return Boolean(
    attempt.stripe_checkout_session_id ||
      attempt.stripe_payment_intent_id ||
      attempt.checkout_url,
  );
}

async function fetchByKey(supabase: DbClient, idempotencyKey: string) {
  const { data } = await supabase
    .from("payment_attempts")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  return data;
}

async function fetchById(supabase: DbClient, id: string) {
  const { data } = await supabase.from("payment_attempts").select("*").eq("id", id).maybeSingle();
  return data;
}

export async function ensurePaymentAttempt(params: {
  supabase: DbClient;
  idempotencyKey?: string | null;
  paymentAttemptId?: string | null;
  flowType: string;
  amountCents: number;
  currency?: string | null;
  userId?: string | null;
  organizationId?: string | null;
  stripeConnectedAccountId?: string | null;
  requestFingerprint?: string | null;
  metadata?: PaymentAttemptInsert["metadata"];
}) {
  const {
    supabase,
    idempotencyKey,
    paymentAttemptId,
    flowType,
    amountCents,
    currency,
    userId,
    organizationId,
    stripeConnectedAccountId,
    requestFingerprint,
    metadata,
  } = params;

  const key = normalizeIdempotencyKey(idempotencyKey, paymentAttemptId || undefined);
  const fingerprint = requestFingerprint || null;
  const currencyCode = normalizeCurrency(currency);

  if (paymentAttemptId) {
    const byId = await fetchById(supabase, paymentAttemptId);
    if (!byId) {
      throw new PaymentAttemptNotFoundError("Payment attempt not found");
    }
    if (byId.idempotency_key !== key) {
      throw new IdempotencyConflictError("Idempotency key does not match stored attempt");
    }
    if (byId.request_fingerprint && fingerprint && byId.request_fingerprint !== fingerprint) {
      throw new IdempotencyConflictError("Idempotency key used for different request payload");
    }
    return { attempt: byId, isNew: false, key };
  }

  const insertPayload: PaymentAttemptInsert = {
    idempotency_key: key,
    flow_type: flowType,
    amount_cents: amountCents,
    currency: currencyCode,
    status: "initiated",
    user_id: userId ?? null,
    organization_id: organizationId ?? null,
    stripe_connected_account_id: stripeConnectedAccountId ?? null,
    request_fingerprint: fingerprint,
    metadata: metadata ?? null,
  };

  const { data: inserted, error } = await supabase
    .from("payment_attempts")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    const pgError = error as PostgrestError;
    if (pgError.code !== UNIQUE_VIOLATION) {
      throw error;
    }

    const existing = await fetchByKey(supabase, key);
    if (!existing) {
      throw error;
    }

    if (existing.request_fingerprint && fingerprint && existing.request_fingerprint !== fingerprint) {
      throw new IdempotencyConflictError("Idempotency key used for different request payload");
    }

    return { attempt: existing, isNew: false, key };
  }

  return { attempt: inserted, isNew: true, key };
}

export async function claimPaymentAttempt(params: {
  supabase: DbClient;
  attempt: PaymentAttempt;
  amountCents: number;
  currency?: string | null;
  stripeConnectedAccountId?: string | null;
  requestFingerprint?: string | null;
}) {
  const {
    supabase,
    attempt,
    amountCents,
    currency,
    stripeConnectedAccountId,
    requestFingerprint,
  } = params;

  if (
    attempt.request_fingerprint &&
    requestFingerprint &&
    attempt.request_fingerprint !== requestFingerprint
  ) {
    throw new IdempotencyConflictError("Idempotency key used for different request payload");
  }

  // SECURITY FIX: Use optimistic locking with additional check for Stripe resources
  const { data, error } = await supabase
    .from("payment_attempts")
    .update({
      status: "processing",
      amount_cents: amountCents,
      currency: normalizeCurrency(currency),
      stripe_connected_account_id: stripeConnectedAccountId ?? attempt.stripe_connected_account_id,
      request_fingerprint: attempt.request_fingerprint || requestFingerprint || null,
      last_error: null,
    })
    .eq("id", attempt.id)
    .eq("status", "initiated")
    .is("stripe_checkout_session_id", null)
    .is("stripe_payment_intent_id", null)
    .select()
    .maybeSingle();

  if (error && (error as PostgrestError).code !== "PGRST116") {
    throw error;
  }

  if (!data) {
    // Failed to claim - someone else got it or it already has Stripe resources
    // Refetch to get current state
    const refetched = await fetchById(supabase, attempt.id);
    if (!refetched) {
      throw new Error("Payment attempt disappeared during claim");
    }
    return { attempt: refetched, claimed: false };
  }

  return { attempt: data, claimed: true };
}

export { fetchById };

export async function updatePaymentAttempt(
  supabase: DbClient,
  attemptId: string,
  updates: Partial<PaymentAttemptUpdate>,
) {
  const { data, error } = await supabase
    .from("payment_attempts")
    .update(updates)
    .eq("id", attemptId)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function waitForExistingStripeResource(
  supabase: DbClient,
  attemptId: string,
  pauseMs = 150,
) {
  await new Promise((resolve) => setTimeout(resolve, pauseMs));

  const { data } = await supabase.from("payment_attempts").select("*").eq("id", attemptId).maybeSingle();
  if (!data) return null;
  if (!hasStripeResource(data)) return null;
  return data;
}
