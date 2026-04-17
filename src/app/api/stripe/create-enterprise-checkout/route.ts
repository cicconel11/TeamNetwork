import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe";
import { getStripeOrigin } from "@/lib/stripe-origin";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  optionalSafeString,
  safeString,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { getBillableOrgCount, isSalesLed } from "@/lib/enterprise/pricing";
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
import { buildEnterpriseCheckoutFingerprintPayload } from "@/lib/payments/enterprise-checkout-fingerprint";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createEnterpriseSchema = z
  .object({
    name: safeString(120),
    slug: baseSchemas.slug,
    billingInterval: z.enum(["month", "year"]),
    alumniBucketQuantity: z.number().int().min(1).max(5),
    subOrgQuantity: z.number().int().min(1).max(1000).optional(),
    billingContactEmail: baseSchemas.email,
    description: optionalSafeString(800),
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
      feature: "enterprise checkout",
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

    const body = await validateJson(req, createEnterpriseSchema, { maxBodyBytes: 32_000 });
    const {
      name,
      slug,
      billingInterval,
      alumniBucketQuantity,
      subOrgQuantity,
      billingContactEmail,
      description,
      idempotencyKey: rawIdempotencyKey,
      paymentAttemptId,
    } = body;

    const idempotencyKey = rawIdempotencyKey ?? null;

    // Check if bucket quantity requires sales-led process
    if (isSalesLed(alumniBucketQuantity)) {
      return respond({
        mode: "sales",
        message: "Enterprise plans with more than 4 alumni buckets (10,000+ alumni) require custom pricing. Please contact sales.",
      });
    }

    // Check slug uniqueness against enterprises
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingEnterprise, error: enterpriseError } = await (serviceSupabase as any)
      .from("enterprises")
      .select("id")
      .eq("slug", slug)
      .maybeSingle() as { data: { id: string } | null; error: { message: string } | null };

    if (enterpriseError) {
      return respond({ error: "Unable to validate slug availability" }, 500);
    }

    if (existingEnterprise) {
      return respond({ error: "Slug is already taken" }, 409);
    }

    // Also check organization slugs to prevent conflicts
    const { data: existingOrg, error: orgError } = await serviceSupabase
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle() as { data: { id: string } | null; error: { message: string } | null };

    if (orgError) {
      return respond({ error: "Unable to validate slug availability" }, 500);
    }

    if (existingOrg) {
      return respond({ error: "Slug is already taken" }, 409);
    }

    let resolvedAttemptId: string | null = null;
    let stripeResourceCreated = false;

    try {
      const origin = getStripeOrigin(req.url);

      // Calculate billable orgs (defaults to 3 if not provided = free tier)
      const totalOrgs = subOrgQuantity ?? 3;
      const billableOrgs = getBillableOrgCount(totalOrgs, alumniBucketQuantity);

      // Get appropriate price IDs based on billing interval
      const alumniBucketPriceId = billingInterval === "month"
        ? requireEnv("STRIPE_PRICE_ENTERPRISE_ALUMNI_BUCKET_MONTHLY")
        : requireEnv("STRIPE_PRICE_ENTERPRISE_ALUMNI_BUCKET_YEARLY");

      const subOrgPriceId = billingInterval === "month"
        ? requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_MONTHLY")
        : requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_YEARLY");

      // Build line items
      const lineItems = [
        {
          price: alumniBucketPriceId,
          quantity: alumniBucketQuantity,
        },
      ];

      // Add sub-org line item only if there are billable orgs
      if (billableOrgs > 0) {
        lineItems.push({
          price: subOrgPriceId,
          quantity: billableOrgs,
        });
      }

      const fingerprint = hashFingerprint(
        buildEnterpriseCheckoutFingerprintPayload({
          userId: user.id,
          slug,
          billingInterval,
          alumniBucketQuantity,
          subOrgQuantity: totalOrgs,
          billingContactEmail,
        }),
      );

      const pendingEnterpriseId = randomUUID();

      const attemptMetadata = {
        pending_enterprise_id: pendingEnterpriseId,
        slug,
        alumni_bucket_quantity: String(alumniBucketQuantity),
        sub_org_quantity: String(totalOrgs),
        billing_interval: billingInterval,
        billing_contact_email: billingContactEmail,
      };

      const { attempt } = await ensurePaymentAttempt({
        supabase: serviceSupabase,
        idempotencyKey,
        paymentAttemptId,
        flowType: "enterprise_checkout",
        amountCents: 0,
        currency: "usd",
        userId: user.id,
        organizationId: null,
        requestFingerprint: fingerprint,
        metadata: attemptMetadata,
      });

      resolvedAttemptId = attempt.id;

      const storedMetadata = (attempt.metadata as Record<string, string> | null) ?? {};
      const persistedEnterpriseId = storedMetadata.pending_enterprise_id || pendingEnterpriseId;

      const { attempt: claimedAttempt, claimed } = await claimPaymentAttempt({
        supabase: serviceSupabase,
        attempt,
        amountCents: 0,
        currency: "usd",
        requestFingerprint: fingerprint,
        stripeConnectedAccountId: null,
      });

      const respondWithExisting = (candidate: typeof claimedAttempt) => {
        if (candidate.checkout_url && candidate.stripe_checkout_session_id) {
          return respond({
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

      // Prepare metadata — identifiers on Stripe mirror the payment-attempt
      // row so the webhook can close the loop idempotently.
      const metadata = {
        type: "enterprise",
        alumni_bucket_quantity: alumniBucketQuantity.toString(),
        sub_org_quantity: totalOrgs.toString(),
        creatorId: user.id,
        enterpriseName: name,
        enterpriseSlug: slug,
        billingContactEmail,
        billingInterval,
        enterpriseDescription: description ?? "",
        payment_attempt_id: claimedAttempt.id,
        pending_enterprise_id: persistedEnterpriseId,
      } as const;

      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer_email: billingContactEmail,
          line_items: lineItems,
          subscription_data: {
            metadata,
          },
          metadata,
          success_url: `${origin}/app?enterprise=${slug}&checkout=success`,
          cancel_url: `${origin}/app/create-enterprise?checkout=cancel`,
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
