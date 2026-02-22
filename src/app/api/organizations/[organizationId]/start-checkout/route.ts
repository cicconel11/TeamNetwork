import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getPriceIds } from "@/lib/stripe";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import type { AlumniBucket, SubscriptionInterval } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

const bodySchema = z
  .object({
    alumniBucket: z.enum(["none", "0-250", "251-500", "501-1000", "1001-2500", "2500-5000", "5000+"]).optional(),
    interval: z.enum(["month", "year"]).optional(),
  })
  .strict();

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { organizationId } = await params;
    const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
    if (!orgIdParsed.success) {
      return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
    }

    const supabase = await createClient();
    const serviceSupabase = createServiceClient();

    const { data: { user } } = await supabase.auth.getUser();
    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "subscription checkout",
      limitPerIp: 50,
      limitPerUser: 30,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    if (!user) return respond({ error: "Unauthorized" }, 401);

    const { data: role } = await supabase
      .from("user_organization_roles")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (role?.role !== "admin") return respond({ error: "Forbidden" }, 403);

    let body: z.infer<typeof bodySchema>;
    try {
      body = await validateJson(req, bodySchema);
    } catch (error) {
      if (error instanceof ValidationError) {
        return respond({ error: error.message, details: error.details }, 400);
      }
      throw error;
    }

    const targetBucket: AlumniBucket = body.alumniBucket ?? "none";
    const interval: SubscriptionInterval = body.interval === "year" ? "year" : "month";

    const { data: org } = await supabase
      .from("organizations")
      .select("id, slug, name, description, primary_color")
      .eq("id", organizationId)
      .maybeSingle();
    if (!org) return respond({ error: "Organization not found" }, 404);

    if (targetBucket === "5000+") {
      await serviceSupabase
        .from("organization_subscriptions")
        .upsert({
          organization_id: organizationId,
          base_plan_interval: interval,
          alumni_bucket: targetBucket,
          alumni_plan_interval: null,
          status: "pending_sales",
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", organizationId);
      return respond({
        mode: "sales",
        message: "Custom pricing required. Our team will reach out.",
      });
    }

    const { basePrice, alumniPrice } = getPriceIds(interval, targetBucket);

    await serviceSupabase
      .from("organization_subscriptions")
      .upsert({
        organization_id: organizationId,
        base_plan_interval: interval,
        alumni_bucket: targetBucket,
        alumni_plan_interval: targetBucket === "none" ? null : interval,
        status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId);

    const { stripe } = await import("@/lib/stripe");
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;

    const metadata = {
      organization_id: org.id,
      organization_slug: org.slug,
      organization_name: org.name,
      organization_description: (org.description ?? "").slice(0, 500),
      organization_color: org.primary_color || "#1e3a5f",
      base_interval: interval,
      alumni_bucket: targetBucket,
    };

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: user.email || undefined,
        line_items: [
          { price: basePrice, quantity: 1 },
          ...(alumniPrice ? [{ price: alumniPrice, quantity: 1 }] : []),
        ],
        subscription_data: { metadata },
        metadata,
        success_url: `${origin}/${org.slug}?checkout=success`,
        cancel_url: `${origin}/${org.slug}?checkout=cancel`,
      });

      return respond({ url: session.url });
    } catch (error) {
      console.error("[start-checkout] Failed to create session", error);
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
