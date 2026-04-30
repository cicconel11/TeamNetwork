import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe";
import { getStripeOrigin } from "@/lib/stripe-origin";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { requireEnv } from "@/lib/env";
import {
  claimPaymentAttempt,
  ensurePaymentAttempt,
  hashFingerprint,
  hasStripeResource,
  IdempotencyConflictError,
  updatePaymentAttempt,
  waitForExistingStripeResource,
} from "@/lib/payments/idempotency";
import { buildDynamicQuoteCheckoutFingerprintPayload } from "@/lib/payments/dynamic-quote-checkout-fingerprint";
import { quote } from "@/lib/pricing-v2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createCustomQuoteSchema = z
  .object({
    tier: z.enum(["single", "enterprise"]),
    actives: z.number().int().min(0).max(1_000_000),
    alumni: z.number().int().min(0).max(1_000_000),
    subOrgs: z.number().int().min(0).max(1_000).optional(),
    billingInterval: z.enum(["month", "year"]),
    idempotencyKey: baseSchemas.idempotencyKey.optional(),
    paymentAttemptId: baseSchemas.uuid.optional(),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const serviceSupabase = createServiceClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "dynamic quote checkout",
      limitPerIp: 30,
      limitPerUser: 15,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    if (!user) {
      return respond({ error: "Unauthorized" }, 401);
    }

    const body = await validateJson(req, createCustomQuoteSchema, { maxBodyBytes: 8_000 });
    const {
      tier,
      actives,
      alumni,
      subOrgs,
      billingInterval,
      idempotencyKey: rawIdempotencyKey,
      paymentAttemptId,
    } = body;

    const idempotencyKey = rawIdempotencyKey ?? null;
    const subOrgsCount = subOrgs ?? 0;

    const q = quote({ tier, actives, alumni, subOrgs: subOrgsCount });

    if (q.salesLed) {
      return respond({
        mode: "sales",
        message: "Contact sales for >100k alumni",
      });
    }

    const unitAmount = billingInterval === "year" ? q.yearlyCents : q.monthlyCents;

    if (unitAmount <= 0) {
      return respond({ error: "Quote total must be greater than zero" }, 400);
    }

    let resolvedAttemptId: string | null = null;
    let stripeResourceCreated = false;

    try {
      const origin = getStripeOrigin(req.url);

      const fingerprint = hashFingerprint(
        buildDynamicQuoteCheckoutFingerprintPayload({
          userId: user.id,
          tier,
          billingInterval,
          actives,
          alumni,
          subOrgs: subOrgsCount,
          monthlyCents: q.monthlyCents,
          yearlyCents: q.yearlyCents,
        }),
      );

      const attemptMetadata: Record<string, unknown> = {
        pricing_model_version: "v2",
        flow_type_v2: "dynamic_quote_checkout",
        tier,
        billing_interval: billingInterval,
        actives,
        alumni,
        sub_orgs: subOrgsCount,
        monthly_cents: q.monthlyCents,
        yearly_cents: q.yearlyCents,
        quote_breakdown: { ...q.breakdown },
      };

      const { attempt } = await ensurePaymentAttempt({
        supabase: serviceSupabase,
        idempotencyKey,
        paymentAttemptId,
        flowType: "dynamic_quote_checkout",
        amountCents: unitAmount,
        currency: "usd",
        userId: user.id,
        organizationId: null,
        requestFingerprint: fingerprint,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: attemptMetadata as any,
      });

      resolvedAttemptId = attempt.id;

      const { attempt: claimedAttempt, claimed } = await claimPaymentAttempt({
        supabase: serviceSupabase,
        attempt,
        amountCents: unitAmount,
        currency: "usd",
        requestFingerprint: fingerprint,
        stripeConnectedAccountId: null,
      });

      const respondWithExisting = (candidate: typeof claimedAttempt) => {
        if (candidate.checkout_url && candidate.stripe_checkout_session_id) {
          return respond({
            mode: "checkout",
            checkoutUrl: candidate.checkout_url,
            idempotencyKey: candidate.idempotency_key,
            paymentAttemptId: candidate.id,
          });
        }
        return null;
      };

      if (!claimed) {
        const existingResponse = hasStripeResource(claimedAttempt)
          ? respondWithExisting(claimedAttempt)
          : null;
        if (existingResponse) return existingResponse;

        const awaited = await waitForExistingStripeResource(serviceSupabase, claimedAttempt.id);
        if (awaited && hasStripeResource(awaited)) {
          const awaitedResponse = respondWithExisting(awaited);
          if (awaitedResponse) return awaitedResponse;
        }

        return respond(
          {
            error: "Checkout is already processing for this idempotency key. Retry shortly with the same key.",
            idempotencyKey: claimedAttempt.idempotency_key,
            paymentAttemptId: claimedAttempt.id,
          },
          409,
        );
      }

      // Stripe metadata caps each value at 500 chars; quote_snapshot is the
      // only field at risk. JSON breakdown is ~180 chars worst case but guard
      // anyway so a future field bump fails loud here, not at Stripe.
      const quoteSnapshot = JSON.stringify(q.breakdown);
      if (quoteSnapshot.length > 500) {
        throw new Error("quote_snapshot exceeds Stripe metadata length cap");
      }

      const sessionMetadata = {
        type: "dynamic_v2",
        pricing_model_version: "v2",
        payment_attempt_id: claimedAttempt.id,
        creator_id: user.id,
        tier,
        billing_interval: billingInterval,
        actives: String(actives),
        alumni: String(alumni),
        sub_orgs: String(subOrgsCount),
        monthly_cents: String(q.monthlyCents),
        yearly_cents: String(q.yearlyCents),
        quote_snapshot: quoteSnapshot,
      } as const;

      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer_email: user.email ?? undefined,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: unitAmount,
                recurring: { interval: billingInterval },
                product: requireEnv("STRIPE_PRODUCT_ID_DYNAMIC"),
              },
            },
          ],
          subscription_data: { metadata: sessionMetadata },
          metadata: sessionMetadata,
          success_url: `${origin}/pricing/calculator?checkout=success`,
          cancel_url: `${origin}/pricing/calculator?checkout=cancel`,
        },
        { idempotencyKey: claimedAttempt.idempotency_key },
      );

      stripeResourceCreated = true;

      await updatePaymentAttempt(serviceSupabase, claimedAttempt.id, {
        stripe_checkout_session_id: session.id,
        checkout_url: session.url,
        status: "processing",
      });

      return respond({
        mode: "checkout",
        checkoutUrl: session.url,
        idempotencyKey: claimedAttempt.idempotency_key,
        paymentAttemptId: claimedAttempt.id,
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return respond({ error: error.message }, 409);
      }

      const stripeErr = error as {
        message?: string;
        raw?: { message?: string };
      };
      const lastError = stripeErr?.message || stripeErr?.raw?.message || "checkout_failed";

      if (resolvedAttemptId) {
        const errorUpdate: { last_error: string; status?: string } = { last_error: lastError };
        if (!stripeResourceCreated) {
          errorUpdate.status = "initiated";
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await serviceSupabase.from("payment_attempts").update(errorUpdate as any).eq("id", resolvedAttemptId);
      }

      const message = error instanceof Error ? error.message : "Unable to create checkout session";
      return respond({ error: message }, 400);
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}
