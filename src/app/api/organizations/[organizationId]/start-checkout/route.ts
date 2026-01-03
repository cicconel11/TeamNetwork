import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getPriceIds } from "@/lib/stripe";
import type { AlumniBucket, SubscriptionInterval } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const supabase = await createClient();
  const serviceSupabase = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: role } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (role?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { alumniBucket?: AlumniBucket; interval?: SubscriptionInterval };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const targetBucket: AlumniBucket = ["none", "0-200", "201-600", "601-1500", "1500+"].includes(
    body.alumniBucket as AlumniBucket,
  )
    ? (body.alumniBucket as AlumniBucket)
    : "none";
  const interval: SubscriptionInterval = body.interval === "year" ? "year" : "month";

  const { data: org } = await supabase
    .from("organizations")
    .select("id, slug, name, description, primary_color")
    .eq("id", organizationId)
    .maybeSingle();
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  if (targetBucket === "1500+") {
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
    return NextResponse.json({
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
  const origin = req.headers.get("origin") ?? new URL(req.url).origin;

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

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("[start-checkout] Failed to create session", error);
    const message = error instanceof Error ? error.message : "Unable to start checkout";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
