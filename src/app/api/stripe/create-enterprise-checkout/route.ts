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
import { getBillableOrgCount, isSalesLed } from "@/lib/enterprise/pricing";
import { requireEnv } from "@/lib/env";

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
      idempotencyKey,
    } = body;

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

    try {
      const origin = req.headers.get("origin") ?? new URL(req.url).origin;

      // Calculate billable orgs (defaults to 3 if not provided = free tier)
      const totalOrgs = subOrgQuantity ?? 3;
      const billableOrgs = getBillableOrgCount(totalOrgs);

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

      // Prepare metadata
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
      } as const;

      // Create Stripe checkout session (always subscription mode)
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
