import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe, getConnectAccountStatus } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  optionalEmail,
  optionalSafeString,
  validateJson,
  ValidationError,
} from "@/lib/security/validation";
import {
  claimPaymentAttempt,
  ensurePaymentAttempt,
  hashFingerprint,
  hasStripeResource,
  IdempotencyConflictError,
  normalizeCurrency,
  updatePaymentAttempt,
  waitForExistingStripeResource,
} from "@/lib/payments/idempotency";
import { calculatePlatformFee } from "@/lib/payments/platform-fee";
import { verifyCaptcha } from "@/lib/security/captcha";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DonationMode = "checkout" | "payment_intent";

const donationSchema = z
  .object({
    organizationId: baseSchemas.uuid.optional(),
    organizationSlug: baseSchemas.slug.optional(),
    amount: z.coerce.number().min(1, "Amount must be at least 1").max(100_000, "Amount too large"),
    currency: baseSchemas.currency.optional(),
    donorName: optionalSafeString(120),
    donorEmail: optionalEmail,
    eventId: baseSchemas.uuid.optional(),
    purpose: optionalSafeString(500),
    mode: z.enum(["checkout", "payment_intent"]).optional(),
    idempotencyKey: baseSchemas.idempotencyKey.optional(),
    paymentAttemptId: baseSchemas.uuid.optional(),
    captchaToken: z.string().min(1, "Captcha verification required"),
    // SECURITY: platformFeeAmountCents is accepted but IGNORED - fee is calculated server-side
    // This field is deprecated and will be removed in a future version
    platformFeeAmountCents: z.coerce.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.organizationId && !value.organizationSlug) {
      ctx.addIssue({ code: "custom", path: ["organizationId"], message: "organizationId or organizationSlug is required" });
    }
  });

export async function POST(req: Request) {
  const supabase = createServiceClient();

  const rateLimit = checkRateLimit(req, {
    userId: null,
    feature: "donation checkout",
    limitPerIp: 45,
    limitPerUser: 30,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  let body: z.infer<typeof donationSchema>;
  try {
    body = await validateJson(req, donationSchema, { maxBodyBytes: 24_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: 400, headers: rateLimit.headers },
      );
    }
    throw error;
  }

  // Verify captcha token before processing donation
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
  const captchaResult = await verifyCaptcha(body.captchaToken, clientIp);
  if (!captchaResult.success) {
    const errorCode = captchaResult.error_codes?.[0];
    if (errorCode === "missing-input-response") {
      return respond({ error: "Captcha verification required" }, 400);
    }
    return respond({ error: "Captcha verification failed" }, 403);
  }

  const amountCents = Math.round(Number(body.amount || 0) * 100);
  if (!Number.isFinite(amountCents) || amountCents < 100) {
    return respond({ error: "Amount must be at least $1.00" }, 400);
  }

  const currency = normalizeCurrency(body.currency);
  const mode: DonationMode = body.mode === "payment_intent" ? "payment_intent" : "checkout";
  // SECURITY: Platform fee is ALWAYS calculated server-side to prevent fee bypass attacks
  // Client-provided platformFeeAmountCents is intentionally ignored
  const platformFeeCents = calculatePlatformFee(amountCents);
  const idempotencyKey = body.idempotencyKey ?? null;
  const paymentAttemptId = body.paymentAttemptId ?? null;

  const orgFilter = body.organizationId
    ? { column: "id", value: body.organizationId }
    : body.organizationSlug
      ? { column: "slug", value: body.organizationSlug }
      : null;

  if (!orgFilter) {
    return respond({ error: "organizationId or organizationSlug is required" }, 400);
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, slug, name, stripe_connect_account_id")
    .eq(orgFilter.column as "id" | "slug", orgFilter.value)
    .maybeSingle();

  if (orgError || !org) {
    return respond({ error: "Organization not found" }, 404);
  }

  if (!org.stripe_connect_account_id) {
    return respond({ error: "Stripe is not connected for this organization" }, 400);
  }

  const connectStatus = await getConnectAccountStatus(org.stripe_connect_account_id);
  if (connectStatus.lookupFailed) {
    return respond({ error: "Unable to verify Stripe connection. Please try again." }, 503);
  }
  if (!connectStatus.isReady) {
    return respond({ error: "Stripe onboarding is not completed for this organization" }, 400);
  }

  if (body.eventId) {
    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", body.eventId)
      .eq("organization_id", org.id)
      .maybeSingle();

    if (!event) {
      return respond({ error: "Philanthropy event not found for this organization" }, 404);
    }
  }

  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  const donorName = body.donorName?.trim();
  const donorEmail = body.donorEmail?.trim();
  const purpose = body.purpose?.trim();
  const stripeAccount = org.stripe_connect_account_id || undefined;
  const stripeOptions = stripeAccount ? { stripeAccount } : {};
  const fingerprint = hashFingerprint({
    orgId: org.id,
    amountCents,
    currency,
    mode,
    donorEmail,
    donorName,
    eventId: body.eventId || null,
    purpose: purpose || null,
    platformFeeCents,
  });
  // Stripe metadata (no PII - stored in payment_attempts instead)
  const metadata: Record<string, string> = {
    organization_id: org.id,
    organization_slug: org.slug,
    flow: mode,
  };

  if (body.eventId) metadata.event_id = body.eventId;
  if (purpose) metadata.purpose = purpose;
  if (platformFeeCents) metadata.platform_fee_cents = String(platformFeeCents);

  // Store donor PII in payment_attempts metadata (not sent to Stripe)
  const paymentAttemptMetadata: Record<string, string> = { ...metadata };
  if (donorName) paymentAttemptMetadata.donor_name = donorName;
  if (donorEmail) paymentAttemptMetadata.donor_email = donorEmail;

  try {
    const { attempt } = await ensurePaymentAttempt({
      supabase,
      idempotencyKey,
      paymentAttemptId,
      flowType: mode === "payment_intent" ? "donation_payment_intent" : "donation_checkout",
      amountCents,
      currency,
      organizationId: org.id,
      stripeConnectedAccountId: org.stripe_connect_account_id,
      requestFingerprint: fingerprint,
      metadata: paymentAttemptMetadata, // Includes donor PII for webhook retrieval
    });

    metadata.payment_attempt_id = attempt.id;

    const { attempt: claimedAttempt, claimed } = await claimPaymentAttempt({
      supabase,
      attempt,
      amountCents,
      currency,
      stripeConnectedAccountId: org.stripe_connect_account_id,
      requestFingerprint: fingerprint,
    });

    const respondWithExisting = async (candidate: typeof claimedAttempt) => {
      if (candidate.stripe_checkout_session_id && candidate.checkout_url) {
        return respond({
          mode,
          sessionId: candidate.stripe_checkout_session_id,
          url: candidate.checkout_url,
          idempotencyKey: candidate.idempotency_key,
          paymentAttemptId: candidate.id,
        });
      }

      if (candidate.stripe_payment_intent_id) {
        const existingPi = await stripe.paymentIntents.retrieve(
          candidate.stripe_payment_intent_id,
          undefined,
          stripeOptions,
        );

        return respond({
          mode: "payment_intent",
          paymentIntentId: existingPi.id,
          clientSecret: existingPi.client_secret,
          idempotencyKey: candidate.idempotency_key,
          paymentAttemptId: candidate.id,
        });
      }

      return null;
    };

    if (!claimed) {
      const existingResponse = hasStripeResource(claimedAttempt)
        ? await respondWithExisting(claimedAttempt)
        : null;

      if (existingResponse) {
        return existingResponse;
      }

      const awaited = await waitForExistingStripeResource(supabase, claimedAttempt.id);
      if (awaited && hasStripeResource(awaited)) {
        const awaitedResponse = await respondWithExisting(awaited);
        if (awaitedResponse) return awaitedResponse;
      }

      return respond(
        {
          error: "Payment is already in progress for this idempotency key. Retry shortly with the same key.",
          idempotencyKey: claimedAttempt.idempotency_key,
          paymentAttemptId: claimedAttempt.id,
        },
        409,
      );
    }

    if (mode === "payment_intent") {
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency,
          automatic_payment_methods: { enabled: true },
          receipt_email: donorEmail || undefined,
          description: purpose ? `Donation: ${purpose}` : `Donation to ${org.name}`,
          metadata,
          application_fee_amount: platformFeeCents || undefined,
        },
        { idempotencyKey: claimedAttempt.idempotency_key, ...stripeOptions },
      );

      await updatePaymentAttempt(supabase, claimedAttempt.id, {
        stripe_payment_intent_id: paymentIntent.id,
        status: "processing",
        stripe_connected_account_id: org.stripe_connect_account_id,
      });

      return respond({
        mode,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        idempotencyKey: claimedAttempt.idempotency_key,
        paymentAttemptId: claimedAttempt.id,
      });
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        submit_type: "donate",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: amountCents,
              product_data: {
                name: `Donation to ${org.name}`,
                metadata,
              },
            },
          },
        ],
        customer_email: donorEmail || undefined,
        metadata,
        payment_intent_data: {
          metadata,
          receipt_email: donorEmail || undefined,
          application_fee_amount: platformFeeCents || undefined,
        },
        success_url: `${origin}/${org.slug}/donations?donation=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/${org.slug}/donations?donation=cancelled`,
      },
      { idempotencyKey: claimedAttempt.idempotency_key, ...stripeOptions },
    );

    if (session.payment_intent && typeof session.payment_intent === "string") {
      await stripe.paymentIntents.update(
        session.payment_intent,
        { metadata: { ...metadata, checkout_session_id: session.id } },
        { idempotencyKey: claimedAttempt.idempotency_key, ...stripeOptions },
      );
    }

    await updatePaymentAttempt(supabase, claimedAttempt.id, {
      stripe_payment_intent_id:
        typeof session.payment_intent === "string" ? session.payment_intent : null,
      stripe_checkout_session_id: session.id,
      checkout_url: session.url,
      status: "processing",
      stripe_connected_account_id: org.stripe_connect_account_id,
    });

    return respond({
      mode,
      sessionId: session.id,
      url: session.url,
      idempotencyKey: claimedAttempt.idempotency_key,
      paymentAttemptId: claimedAttempt.id,
    });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return respond({ error: error.message }, 409);
    }

    const message = error instanceof Error ? error.message : "Unable to start donation checkout";
    if (paymentAttemptId) {
      await supabase.from("payment_attempts").update({ last_error: message }).eq("id", paymentAttemptId);
    } else if (idempotencyKey) {
      await supabase.from("payment_attempts").update({ last_error: message }).eq("idempotency_key", idempotencyKey);
    }
    console.error("[create-donation] Error:", message);
    return respond({ error: message }, 400);
  }
}
