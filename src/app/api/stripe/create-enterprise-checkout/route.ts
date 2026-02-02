import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe";
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
import { getEnterprisePricing } from "@/lib/enterprise/pricing";
import type { EnterpriseTier, BillingInterval } from "@/types/enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createEnterpriseSchema = z
  .object({
    name: safeString(120),
    slug: baseSchemas.slug,
    billingInterval: z.enum(["month", "year"]),
    tier: z.enum(["tier_1", "tier_2", "tier_3", "custom"]),
    billingContactEmail: baseSchemas.email,
    description: optionalSafeString(800),
    idempotencyKey: baseSchemas.idempotencyKey.optional(),
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
      tier,
      billingContactEmail,
      description,
      idempotencyKey,
    } = body;

    // Check slug uniqueness against enterprises
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingEnterprise } = await (serviceSupabase as any)
      .from("enterprises")
      .select("id")
      .eq("slug", slug)
      .maybeSingle() as { data: { id: string } | null };

    if (existingEnterprise) {
      return respond({ error: "Slug is already taken" }, 409);
    }

    // Also check organization slugs to prevent conflicts
    const { data: existingOrg } = await serviceSupabase
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (existingOrg) {
      return respond({ error: "Slug is already taken" }, 409);
    }

    const interval: BillingInterval = billingInterval;
    const enterpriseTier: EnterpriseTier = tier;

    // Get pricing for the tier
    const priceCents = getEnterprisePricing(enterpriseTier, interval);

    // tier_3 and custom require sales-led process
    if (priceCents === null) {
      return respond({
        mode: "sales",
        message: "This tier requires custom pricing. Please contact sales.",
      });
    }

    try {
      const origin = req.headers.get("origin") ?? new URL(req.url).origin;

      // Create Stripe checkout session
      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer_email: billingContactEmail,
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: priceCents,
                recurring: {
                  interval: interval === "year" ? "year" : "month",
                },
                product_data: {
                  name: `Enterprise Plan - ${formatTierDisplayName(enterpriseTier)}`,
                  description: `TeamNetwork Enterprise subscription for ${name}`,
                },
              },
              quantity: 1,
            },
          ],
          subscription_data: {
            metadata: {
              type: "enterprise",
              tier: enterpriseTier,
              creatorId: user.id,
              enterpriseName: name,
              enterpriseSlug: slug,
              enterpriseDescription: description ?? "",
              billingContactEmail,
              billingInterval: interval,
            },
          },
        metadata: {
          type: "enterprise",
          tier: enterpriseTier,
          creatorId: user.id,
          enterpriseName: name,
          enterpriseSlug: slug,
          enterpriseDescription: description ?? "",
          billingContactEmail,
          billingInterval: interval,
        },
          success_url: `${origin}/app?enterprise=${slug}&checkout=success`,
          cancel_url: `${origin}/app/create-enterprise?checkout=cancel`,
        },
        idempotencyKey ? { idempotencyKey } : undefined,
      );

      return respond({ checkoutUrl: session.url });
    } catch (error) {
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

function formatTierDisplayName(tier: EnterpriseTier): string {
  switch (tier) {
    case "tier_1":
      return "Tier 1 (Up to 5,000 alumni)";
    case "tier_2":
      return "Tier 2 (Up to 10,000 alumni)";
    case "tier_3":
      return "Tier 3 (Unlimited alumni)";
    case "custom":
      return "Custom Plan";
  }
}
