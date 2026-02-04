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
import {
  canDevAdminPerform,
  logDevAdminAction,
  extractRequestContext,
} from "@/lib/auth/dev-admin";
import type { Database } from "@/types/database";
import { createTelemetryReporter, reportExternalServiceWarning } from "@/lib/telemetry/server";

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
  const telemetry = createTelemetryReporter({
    apiPath: "/api/stripe/billing-portal",
    method: "POST",
  });

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    telemetry.setUserId(user?.id ?? null);

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

    const isDevAdminAllowed = canDevAdminPerform(user, "open_billing_portal");
    if (role?.role !== "admin" && !isDevAdminAllowed) {
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
        await reportExternalServiceWarning(
          "stripe",
          `Unable to backfill customer from subscription ${stripeSubId}`,
          telemetry.getContext(),
          { stripeSubId, organizationId: organization.id }
        );
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

    // If still no customer ID, try to find it from payment attempts
    // Use flow_type + checkout session presence instead of status to be resilient
    // to status semantics (we now sometimes store subscription statuses like 'active')
    if (!stripeCustomerId) {
      const serviceSupabase = createServiceClient();
      const { data: paymentAttempt } = await serviceSupabase
        .from("payment_attempts")
        .select("stripe_checkout_session_id, organization_id")
        .eq("organization_id", organization.id)
        .eq("flow_type", "subscription_checkout")
        .not("stripe_checkout_session_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (paymentAttempt?.stripe_checkout_session_id) {
        try {
          const session = await stripe.checkout.sessions.retrieve(paymentAttempt.stripe_checkout_session_id, {
            expand: ["subscription", "customer"],
          });
          const customerId =
            typeof session.customer === "string" ? session.customer : session.customer?.id || null;
          if (customerId) {
            stripeCustomerId = customerId;
            await serviceSupabase
              .from("organization_subscriptions")
              .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
              .eq("organization_id", organization.id);
          }
        } catch (error) {
          console.error("[billing-portal] Failed to retrieve customer from checkout session", error);
          await reportExternalServiceWarning(
            "stripe",
            `Failed to retrieve customer from checkout session ${paymentAttempt.stripe_checkout_session_id}`,
            telemetry.getContext(),
            { checkoutSessionId: paymentAttempt.stripe_checkout_session_id, organizationId: organization.id }
          );
        }
      }
    }

    if (!stripeCustomerId) {
      return respond(
        {
          error: "No active billing subscription found. If you recently completed payment, try refreshing the page or contact support. You can also try the 'Reconcile Subscription' option in settings.",
          stripe_subscription_id: stripeSubId,
        },
        400,
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${origin}/${organization.slug}`,
    });

    // Log dev-admin action after creating billing portal session
    if (isDevAdminAllowed) {
      logDevAdminAction({
        adminUserId: user.id,
        adminEmail: user.email ?? "",
        action: "open_billing_portal",
        targetType: "billing",
        targetId: organization.id,
        targetSlug: organization.slug,
        ...extractRequestContext(req),
      });
    }

    return respond({ url: session.url });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}







