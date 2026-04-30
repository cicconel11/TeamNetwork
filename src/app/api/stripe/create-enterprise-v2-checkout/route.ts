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
  updatePaymentAttempt,
  waitForExistingStripeResource,
} from "@/lib/payments/idempotency";
import {
  buildCheckoutErrorResponse,
  classifyCheckoutError,
  extractErrorMessage,
} from "@/lib/payments/stripe-error";
import { buildEnterpriseV2CheckoutFingerprintPayload } from "@/lib/payments/enterprise-v2-checkout-fingerprint";
import { quote, isSelfServeSalesLed } from "@/lib/pricing-v2";
import { createEnterpriseV2Schema } from "@/lib/schemas/organization-v2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const serviceSupabase = createServiceClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "enterprise v2 checkout",
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

    const body = await validateJson(req, createEnterpriseV2Schema, { maxBodyBytes: 8_000 });
    const {
      name,
      slug,
      description,
      primaryColor,
      billingInterval,
      actives,
      alumni,
      subOrgs,
      billingContactEmail,
      idempotencyKey: rawIdempotencyKey,
      paymentAttemptId,
    } = body;

    const idempotencyKey = rawIdempotencyKey ?? null;

    // Slug uniqueness across enterprises + organizations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingEnterprise } = await (serviceSupabase as any)
      .from("enterprises")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (existingEnterprise) {
      return respond({ error: "Slug is already taken" }, 409);
    }
    const { data: existingOrg } = await serviceSupabase
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (existingOrg) {
      return respond({ error: "Slug is already taken" }, 409);
    }

    // Sales-led pre-creation: enterprise row + owner role + pending_sales subscription.
    if (isSelfServeSalesLed({ tier: "enterprise", actives, alumni, subOrgs })) {
      const q = quote({ tier: "enterprise", actives, alumni, subOrgs });
      const snapshot = {
        tier: "enterprise",
        actives,
        alumni,
        subOrgs,
        monthlyCents: q.monthlyCents,
        yearlyCents: q.yearlyCents,
        billingInterval,
        breakdown: q.breakdown,
        salesLed: true,
      };

      let enterpriseId: string | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: ent, error: entErr } = await (serviceSupabase as any)
          .from("enterprises")
          .insert({
            name,
            slug,
            description: description || null,
            billing_contact_email: billingContactEmail,
          })
          .select()
          .single();
        if (entErr || !ent) throw new Error(entErr?.message || "Unable to create enterprise");
        enterpriseId = ent.id;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: roleErr } = await (serviceSupabase as any)
          .from("user_enterprise_roles")
          .insert({ user_id: user.id, enterprise_id: ent.id, role: "owner" });
        if (roleErr) throw new Error(roleErr.message);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: subErr } = await (serviceSupabase as any)
          .from("enterprise_subscriptions")
          .insert({
            enterprise_id: ent.id,
            billing_interval: billingInterval,
            status: "pending_sales",
            pricing_model_version: "v2",
            pricing_v2_snapshot: snapshot,
          });
        if (subErr) throw new Error(subErr.message);

        return respond({ mode: "sales", enterpriseSlug: ent.slug });
      } catch (error) {
        if (enterpriseId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (serviceSupabase as any).from("enterprise_subscriptions").delete().eq("enterprise_id", enterpriseId);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (serviceSupabase as any).from("user_enterprise_roles").delete().eq("enterprise_id", enterpriseId).eq("user_id", user.id);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (serviceSupabase as any).from("enterprises").delete().eq("id", enterpriseId);
        }
        const message = error instanceof Error ? error.message : "Unable to start checkout";
        console.error("[create-enterprise-v2-checkout] sales-led error:", message);
        return buildCheckoutErrorResponse(error, { headers: rateLimit.headers });
      }
    }

    const q = quote({ tier: "enterprise", actives, alumni, subOrgs });
    const unitAmount = billingInterval === "year" ? q.yearlyCents : q.monthlyCents;
    if (unitAmount <= 0) {
      return respond({ error: "Quote total must be greater than zero" }, 400);
    }

    let resolvedAttemptId: string | null = null;
    let stripeResourceCreated = false;

    try {
      const origin = getStripeOrigin(req.url);

      const fingerprint = hashFingerprint(
        buildEnterpriseV2CheckoutFingerprintPayload({
          userId: user.id,
          slug,
          billingInterval,
          actives,
          alumni,
          subOrgs,
          monthlyCents: q.monthlyCents,
          yearlyCents: q.yearlyCents,
          billingContactEmail,
        }),
      );

      const attemptMetadata: Record<string, unknown> = {
        flow_type_v2: "enterprise_v2_checkout",
        pricing_model_version: "v2",
        tier: "enterprise",
        slug,
        billing_interval: billingInterval,
        actives,
        alumni,
        sub_orgs: subOrgs,
        monthly_cents: q.monthlyCents,
        yearly_cents: q.yearlyCents,
        quote_breakdown: { ...q.breakdown },
      };

      const { attempt } = await ensurePaymentAttempt({
        supabase: serviceSupabase,
        idempotencyKey,
        paymentAttemptId,
        flowType: "enterprise_v2_checkout",
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
        type: "enterprise_v2",
        pricing_model_version: "v2",
        payment_attempt_id: claimedAttempt.id,
        creator_id: user.id,
        tier: "enterprise",
        billing_interval: billingInterval,
        actives: String(actives),
        alumni: String(alumni),
        sub_orgs: String(subOrgs),
        monthly_cents: String(q.monthlyCents),
        yearly_cents: String(q.yearlyCents),
        quote_snapshot: quoteSnapshot,
        enterprise_name: name.slice(0, 200),
        enterprise_slug: slug,
        enterprise_description: (description || "").slice(0, 500),
        enterprise_primary_color: primaryColor,
        billing_contact_email: billingContactEmail,
      } as const;

      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer_email: billingContactEmail,
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
        mode: "checkout",
        checkoutUrl: session.url,
        url: session.url,
        idempotencyKey: claimedAttempt.idempotency_key,
        paymentAttemptId: claimedAttempt.id,
      });
    } catch (error) {
      const lastError = extractErrorMessage(error);
      const errorClass = classifyCheckoutError(error);

      if (resolvedAttemptId) {
        const errorUpdate: { last_error: string; status?: string } = { last_error: lastError };
        if (!stripeResourceCreated) {
          errorUpdate.status = "initiated";
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await serviceSupabase.from("payment_attempts").update(errorUpdate as any).eq("id", resolvedAttemptId);
      }

      console.error("[create-enterprise-v2-checkout] error:", { errorClass, lastError });
      return buildCheckoutErrorResponse(error, { headers: rateLimit.headers });
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}
