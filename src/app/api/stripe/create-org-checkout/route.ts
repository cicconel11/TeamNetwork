import { NextResponse } from "next/server";
import { stripe, getPriceIds, isSalesLedBucket } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import type { AlumniBucket, SubscriptionInterval } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RequestBody {
  name: string;
  slug: string;
  description?: string;
  primaryColor?: string;
  billingInterval: SubscriptionInterval;
  alumniBucket: AlumniBucket;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { name, slug, description, primaryColor, billingInterval, alumniBucket } = body;

  const interval: SubscriptionInterval = billingInterval === "year" ? "year" : "month";
  const bucket: AlumniBucket = ["none", "0-200", "201-600", "601-1500", "1500+"].includes(alumniBucket)
    ? alumniBucket
    : "none";

  if (!name || !slug) {
    return NextResponse.json({ error: "Name and slug are required" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Slug is already taken" }, { status: 409 });
  }

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

    const initialStatus = isSalesLedBucket(bucket) ? "pending_sales" : "pending";
    const { error: subError } = await supabase
      .from("organization_subscriptions")
      .insert({
        organization_id: org.id,
        base_plan_interval: interval,
        alumni_bucket: bucket,
        alumni_plan_interval: bucket === "none" || bucket === "1500+" ? null : interval,
        status: initialStatus,
      });

    if (subError) {
      throw new Error(subError.message);
    }

    if (isSalesLedBucket(bucket)) {
      return NextResponse.json({
        mode: "sales",
        organizationSlug: org.slug,
      });
    }

    const { basePrice, alumniPrice } = getPriceIds(interval, bucket);
    const origin = req.headers.get("origin") ?? new URL(req.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email || undefined,
      line_items: [
        { price: basePrice, quantity: 1 },
        ...(alumniPrice ? [{ price: alumniPrice, quantity: 1 }] : []),
      ],
      subscription_data: {
        metadata: {
          organization_id: org.id,
          organization_slug: org.slug,
          alumni_bucket: bucket,
          created_by: user.id,
          base_interval: interval,
        },
      },
      metadata: {
        organization_id: org.id,
        organization_slug: org.slug,
        alumni_bucket: bucket,
        created_by: user.id,
        base_interval: interval,
      },
      success_url: `${origin}/app?org=${org.slug}&checkout=success`,
      cancel_url: `${origin}/app?org=${org.slug}&checkout=cancel`,
    });

    if (typeof session.customer === "string") {
      await supabase
        .from("organization_subscriptions")
        .update({ stripe_customer_id: session.customer })
        .eq("organization_id", org.id);
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (organizationId) {
      // Best-effort cleanup on failure
      await supabase.from("organization_subscriptions").delete().eq("organization_id", organizationId);
      await supabase.from("user_organization_roles").delete().eq("organization_id", organizationId).eq("user_id", user.id);
      await supabase.from("organizations").delete().eq("id", organizationId);
    }
    const message = error instanceof Error ? error.message : "Unable to start checkout";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}


