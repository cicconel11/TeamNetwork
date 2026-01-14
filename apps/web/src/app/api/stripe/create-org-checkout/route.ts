import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { stripe, getPriceIds, isSalesLedBucket } from "@/lib/stripe";
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
import {
  claimPaymentAttempt,
  ensurePaymentAttempt,
  hashFingerprint,
  hasStripeResource,
  IdempotencyConflictError,
  updatePaymentAttempt,
  waitForExistingStripeResource,
} from "@/lib/payments/idempotency";
import { z } from "zod";
import type { AlumniBucket, SubscriptionInterval } from "@teammeet/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createOrgSchema = z
  .object({
    name: safeString(120),
    slug: baseSchemas.slug,
    description: optionalSafeString(800),
    primaryColor: baseSchemas.hexColor.optional(),
    billingInterval: z.enum(["month", "year"]),
    alumniBucket: z.enum(["none", "0-250", "251-500", "501-1000", "1001-2500", "2500-5000", "5000+"]),
    idempotencyKey: baseSchemas.idempotencyKey.optional(),
    paymentAttemptId: baseSchemas.uuid.optional(),
  })
  .strict();

export async function POST(req: Request) {
  try {
    console.log("[create-org-checkout] Starting...");
    const supabase = await createClient();
    const serviceSupabase = createServiceClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "organization checkout",
      limitPerIp: 45,
      limitPerUser: 25,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    if (!user) {
      console.log("[create-org-checkout] Unauthorized - no user");
      return respond({ error: "Unauthorized" }, 401);
    }
    console.log("[create-org-checkout] User:", user.id, user.email);

    const body = await validateJson(req, createOrgSchema, { maxBodyBytes: 32_000 });
    const {
      name,
      slug,
      description,
      primaryColor,
      billingInterval,
      alumniBucket,
      idempotencyKey: rawIdempotencyKey,
      paymentAttemptId,
    } = body;

    const idempotencyKey = rawIdempotencyKey ?? null;
    const interval: SubscriptionInterval = billingInterval === "year" ? "year" : "month";
    const bucket: AlumniBucket = alumniBucket;

    const { data: existing } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (existing) {
      return respond({ error: "Slug is already taken" }, 409);
    }

    if (isSalesLedBucket(bucket)) {
      let organizationId: string | null = null;

      try {
        const { data: org, error: orgError } = await supabase
          .from("organizations")
          .insert({
            name,
            slug,
            description: description || null,
            primary_color: primaryColor || "#1e3a5f",
          })
          .select()
          .single();

        if (orgError || !org) {
          throw new Error(orgError?.message || "Unable to create organization");
        }

        organizationId = org.id;

        const { error: roleError } = await supabase
          .from("user_organization_roles")
          .insert({
            user_id: user.id,
            organization_id: org.id,
            role: "admin",
          });

        if (roleError) {
          throw new Error(roleError.message);
        }

        const { error: subError } = await supabase
          .from("organization_subscriptions")
          .insert({
            organization_id: org.id,
            base_plan_interval: interval,
            alumni_bucket: bucket,
            alumni_plan_interval: null,
            status: "pending_sales",
          });

        if (subError) {
          throw new Error(subError.message);
        }

        return respond({
          mode: "sales",
          organizationSlug: org.slug,
        });
      } catch (error) {
        const stripeErr = error as {
          type?: string;
          code?: string;
          message?: string;
          param?: string;
          statusCode?: number;
          raw?: { message?: string };
        };
        console.error("[create-org-checkout] Error details (sales-led):", {
          type: stripeErr?.type,
          code: stripeErr?.code,
          param: stripeErr?.param,
          statusCode: stripeErr?.statusCode,
          message: stripeErr?.message || stripeErr?.raw?.message || (error instanceof Error ? error.message : String(error)),
        });

        if (organizationId) {
          console.log("[create-org-checkout] Cleaning up org:", organizationId);
          await supabase.from("organization_subscriptions").delete().eq("organization_id", organizationId);
          await supabase.from("user_organization_roles").delete().eq("organization_id", organizationId).eq("user_id", user.id);
          await supabase.from("organizations").delete().eq("id", organizationId);
        }

        const message = error instanceof Error ? error.message : "Unable to start checkout";
        return respond({ error: message }, 400);
      }
    }

    try {
      const { basePrice, alumniPrice } = getPriceIds(interval, bucket);
      const origin = req.headers.get("origin") ?? new URL(req.url).origin;
      const pendingOrgIdSeed = randomUUID();
      const fingerprint = hashFingerprint({
        userId: user.id,
        name,
        slug,
        interval,
        bucket,
        primaryColor,
      });

      const attemptMetadata = {
        pending_org_id: pendingOrgIdSeed,
        slug,
        alumni_bucket: bucket,
        billing_interval: interval,
      };

      const { attempt } = await ensurePaymentAttempt({
        supabase: serviceSupabase,
        idempotencyKey,
        paymentAttemptId,
        flowType: "subscription_checkout",
        amountCents: 0,
        currency: "usd",
        userId: user.id,
        requestFingerprint: fingerprint,
        metadata: attemptMetadata,
      });

      const storedMetadata = (attempt.metadata as Record<string, string> | null) ?? {};
      const pendingOrgId = storedMetadata.pending_org_id || pendingOrgIdSeed;
      const metadata = {
        organization_id: pendingOrgId,
        organization_slug: slug,
        organization_name: name,
        organization_description: (description || "").slice(0, 500),
        organization_color: primaryColor || "#1e3a5f",
        alumni_bucket: bucket,
        created_by: user.id,
        base_interval: interval,
        payment_attempt_id: attempt.id,
      };

      const { attempt: claimedAttempt, claimed } = await claimPaymentAttempt({
        supabase: serviceSupabase,
        attempt,
        amountCents: 0,
        currency: "usd",
        requestFingerprint: fingerprint,
        stripeConnectedAccountId: null,
      });

      const respondWithExisting = (candidate: typeof claimedAttempt) => {
        if (candidate.stripe_checkout_session_id && candidate.checkout_url) {
          return respond({
            url: candidate.checkout_url,
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

      console.log("[create-org-checkout] Creating Stripe session with prices:", { basePrice, alumniPrice, origin, pendingOrgId });

      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer_email: user.email || undefined,
          line_items: [
            { price: basePrice, quantity: 1 },
            ...(alumniPrice ? [{ price: alumniPrice, quantity: 1 }] : []),
          ],
          subscription_data: {
            metadata,
          },
          metadata,
          success_url: `${origin}/app?org=${slug}&checkout=success`,
          cancel_url: `${origin}/app?org=${slug}&checkout=cancel`,
        },
        { idempotencyKey: claimedAttempt.idempotency_key },
      );

      await updatePaymentAttempt(serviceSupabase, claimedAttempt.id, {
        stripe_checkout_session_id: session.id,
        checkout_url: session.url,
        status: "processing",
      });

      console.log("[create-org-checkout] Success! Checkout URL:", session.url);
      return respond({
        url: session.url,
        idempotencyKey: claimedAttempt.idempotency_key,
        paymentAttemptId: claimedAttempt.id,
      });
    } catch (error) {
      const stripeErr = error as {
        type?: string;
        code?: string;
        message?: string;
        param?: string;
        statusCode?: number;
        raw?: { message?: string };
      };

      if (error instanceof IdempotencyConflictError) {
        return respond({ error: error.message }, 409);
      }

      console.error("[create-org-checkout] Error details:", {
        type: stripeErr?.type,
        code: stripeErr?.code,
        param: stripeErr?.param,
        statusCode: stripeErr?.statusCode,
        message: stripeErr?.message || stripeErr?.raw?.message || (error instanceof Error ? error.message : String(error)),
      });

      const lastError = stripeErr?.message || stripeErr?.raw?.message || "checkout_failed";
      if (paymentAttemptId) {
        await serviceSupabase.from("payment_attempts").update({ last_error: lastError }).eq("id", paymentAttemptId);
      } else if (idempotencyKey) {
        await serviceSupabase.from("payment_attempts").update({ last_error: lastError }).eq("idempotency_key", idempotencyKey);
      }

      const message = error instanceof Error ? error.message : "Unable to start checkout";
      return respond({ error: message }, 400);
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}
