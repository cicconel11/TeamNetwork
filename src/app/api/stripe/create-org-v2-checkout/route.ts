import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getStripeOrigin } from "@/lib/stripe-origin";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
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
import { buildOrgV2CheckoutFingerprintPayload } from "@/lib/payments/org-v2-checkout-fingerprint";
import { quote, isSelfServeSalesLed } from "@/lib/pricing-v2";
import { createOrgV2Schema } from "@/lib/schemas/organization-v2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const serviceSupabase = createServiceClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "org v2 checkout",
      limitPerIp: 45,
      limitPerUser: 25,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    if (!user) {
      return respond({ error: "Unauthorized" }, 401);
    }

    const body = await validateJson(req, createOrgV2Schema, { maxBodyBytes: 8_000 });
    const {
      name,
      slug,
      description,
      primaryColor,
      billingInterval,
      actives,
      alumni,
      idempotencyKey: rawIdempotencyKey,
      paymentAttemptId,
    } = body;

    const idempotencyKey = rawIdempotencyKey ?? null;

    const { data: existingOrg } = await serviceSupabase
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (existingOrg) {
      return respond({ error: "Slug is already taken" }, 409);
    }

    // Sales-led: bypass Stripe, pre-create org with status=pending_sales.
    if (isSelfServeSalesLed({ tier: "single", actives, alumni })) {
      const q = quote({ tier: "single", actives, alumni });
      const snapshot = {
        tier: "single",
        actives,
        alumni,
        monthlyCents: q.monthlyCents,
        yearlyCents: q.yearlyCents,
        billingInterval,
        breakdown: q.breakdown,
        salesLed: true,
      };

      let orgId: string | null = null;
      try {
        const { data: org, error: orgError } = await supabase
          .from("organizations")
          .insert({
            name,
            slug,
            description: description || null,
            primary_color: primaryColor,
          })
          .select()
          .single();
        if (orgError || !org) throw new Error(orgError?.message || "Unable to create organization");
        orgId = org.id;

        const { error: roleError } = await supabase
          .from("user_organization_roles")
          .insert({ user_id: user.id, organization_id: org.id, role: "admin" });
        if (roleError) throw new Error(roleError.message);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: subError } = await (serviceSupabase as any)
          .from("organization_subscriptions")
          .insert({
            organization_id: org.id,
            base_plan_interval: billingInterval,
            alumni_bucket: "none",
            alumni_plan_interval: null,
            status: "pending_sales",
            pricing_model_version: "v2",
            pricing_v2_snapshot: snapshot,
          });
        if (subError) throw new Error(subError.message);

        return respond({ mode: "sales", organizationSlug: org.slug });
      } catch (error) {
        if (orgId) {
          await supabase.from("organization_subscriptions").delete().eq("organization_id", orgId);
          await supabase.from("user_organization_roles").delete().eq("organization_id", orgId).eq("user_id", user.id);
          await supabase.from("organizations").delete().eq("id", orgId);
        }
        const message = error instanceof Error ? error.message : "Unable to start checkout";
        console.error("[create-org-v2-checkout] Sales-led error:", message);
        return respond({ error: "Unable to start checkout" }, 400);
      }
    }

    const q = quote({ tier: "single", actives, alumni });
    const unitAmount = billingInterval === "year" ? q.yearlyCents : q.monthlyCents;
    if (unitAmount <= 0) {
      return respond({ error: "Quote total must be greater than zero" }, 400);
    }

    let resolvedAttemptId: string | null = null;
    let stripeResourceCreated = false;

    try {
      const origin = getStripeOrigin(req.url);

      const fingerprint = hashFingerprint(
        buildOrgV2CheckoutFingerprintPayload({
          userId: user.id,
          slug,
          billingInterval,
          actives,
          alumni,
          monthlyCents: q.monthlyCents,
          yearlyCents: q.yearlyCents,
          primaryColor,
        }),
      );

      const attemptMetadata: Record<string, unknown> = {
        flow_type_v2: "org_v2_checkout",
        pricing_model_version: "v2",
        tier: "single",
        slug,
        billing_interval: billingInterval,
        actives,
        alumni,
        monthly_cents: q.monthlyCents,
        yearly_cents: q.yearlyCents,
        quote_breakdown: { ...q.breakdown },
      };

      const { attempt } = await ensurePaymentAttempt({
        supabase: serviceSupabase,
        idempotencyKey,
        paymentAttemptId,
        flowType: "org_v2_checkout",
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

      const quoteSnapshot = JSON.stringify(q.breakdown);
      if (quoteSnapshot.length > 500) {
        throw new Error("quote_snapshot exceeds Stripe metadata length cap");
      }

      const sessionMetadata = {
        type: "org_v2",
        pricing_model_version: "v2",
        payment_attempt_id: claimedAttempt.id,
        creator_id: user.id,
        tier: "single",
        billing_interval: billingInterval,
        actives: String(actives),
        alumni: String(alumni),
        monthly_cents: String(q.monthlyCents),
        yearly_cents: String(q.yearlyCents),
        quote_snapshot: quoteSnapshot,
        org_name: name.slice(0, 200),
        org_slug: slug,
        org_description: (description || "").slice(0, 500),
        org_primary_color: primaryColor,
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
          success_url: `${origin}/app?org=${slug}&checkout=success`,
          cancel_url: `${origin}/app/create-org?checkout=cancel`,
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
        url: session.url,
        idempotencyKey: claimedAttempt.idempotency_key,
        paymentAttemptId: claimedAttempt.id,
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return respond({ error: error.message }, 409);
      }

      const stripeErr = error as { message?: string; raw?: { message?: string } };
      const lastError = stripeErr?.message || stripeErr?.raw?.message || "checkout_failed";

      if (resolvedAttemptId) {
        const errorUpdate: { last_error: string; status?: string } = { last_error: lastError };
        if (!stripeResourceCreated) {
          errorUpdate.status = "initiated";
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await serviceSupabase.from("payment_attempts").update(errorUpdate as any).eq("id", resolvedAttemptId);
      }

      console.error("[create-org-v2-checkout] error:", lastError);
      return respond({ error: "Unable to start checkout" }, 400);
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}
