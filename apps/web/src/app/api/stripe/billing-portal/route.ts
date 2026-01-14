import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z
  .object({
    organizationId: baseSchemas.uuid.optional(),
    orgSlug: baseSchemas.slug.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.organizationId && !value.orgSlug) {
      ctx.addIssue({ code: "custom", message: "organizationId or orgSlug is required", path: ["organizationId"] });
    }
  })
  .strict();

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "billing portal",
      limitPerIp: 40,
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

    const { organizationId, orgSlug } = await validateJson(req, requestSchema);
    const origin = req.headers.get("origin") ?? new URL(req.url).origin;

    const orgQuery = supabase
      .from("organizations")
      .select("id, slug")
      .limit(1);

    if (organizationId) {
      orgQuery.eq("id", organizationId);
    } else if (orgSlug) {
      orgQuery.eq("slug", orgSlug);
    }

    const { data: organization } = await orgQuery.single();
    if (!organization) {
      return respond({ error: "Organization not found" }, 404);
    }

    const { data: role } = await supabase
      .from("user_organization_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", organization.id)
      .maybeSingle();

    if (role?.role !== "admin") {
      return respond({ error: "Forbidden" }, 403);
    }

    type OrgSub = Database["public"]["Tables"]["organization_subscriptions"]["Row"];
    const { data: subscription, error: subError } = await supabase
      .from("organization_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("organization_id", organization.id)
      .maybeSingle();

    if (subError) {
      console.error("[billing-portal] Failed to load subscription row", subError);
    }

    let stripeCustomerId = (subscription as OrgSub | null)?.stripe_customer_id || null;
    const stripeSubId = (subscription as OrgSub | null)?.stripe_subscription_id || null;

    // Attempt to backfill missing customer from Stripe using subscription id
    if (!stripeCustomerId && stripeSubId) {
      try {
        const sub = await stripe.subscriptions.retrieve(stripeSubId);
        const customerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null;
        if (customerId) {
          stripeCustomerId = customerId;
          const serviceSupabase = createServiceClient();
          await serviceSupabase
            .from("organization_subscriptions")
            .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
            .eq("organization_id", organization.id);
        }
      } catch (error) {
        console.error("[billing-portal] Unable to backfill Stripe customer id", error);
        // If subscription doesn't exist in Stripe, clear it from database
        if (error instanceof Error && error.message.includes("No such subscription")) {
          console.log("[billing-portal] Clearing invalid subscription ID for org:", organization.id);
          const serviceSupabase = createServiceClient();
          await serviceSupabase
            .from("organization_subscriptions")
            .update({
              stripe_subscription_id: null,
              stripe_customer_id: null,
              status: "canceled",
              updated_at: new Date().toISOString(),
            })
            .eq("organization_id", organization.id);
        }
      }
    }

    if (!stripeCustomerId) {
      return respond(
        {
          error: "No active billing subscription. Please set up billing by selecting a plan and clicking 'Update plan'.",
          stripe_subscription_id: stripeSubId,
        },
        400,
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${origin}/${organization.slug}`,
    });

    return respond({ url: session.url });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}







