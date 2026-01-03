import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RequestBody {
  organizationId?: string;
  orgSlug?: string;
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

  const { organizationId, orgSlug } = body;
  const origin = req.headers.get("origin") ?? new URL(req.url).origin;

  const orgQuery = supabase
    .from("organizations")
    .select("id, slug")
    .limit(1);

  if (organizationId) {
    orgQuery.eq("id", organizationId);
  } else if (orgSlug) {
    orgQuery.eq("slug", orgSlug);
  } else {
    return NextResponse.json({ error: "Organization required" }, { status: 400 });
  }

  const { data: organization } = await orgQuery.single();
  if (!organization) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const { data: role } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (role?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: subscription } = await supabase
    .from("organization_subscriptions")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("organization_id", organization.id)
    .maybeSingle();

  let stripeCustomerId = subscription?.stripe_customer_id || null;

  // Attempt to backfill missing customer from Stripe using subscription id
  if (!stripeCustomerId && subscription?.stripe_subscription_id) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
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
    }
  }

  if (!stripeCustomerId) {
    return NextResponse.json({ error: "No Stripe customer found for this org" }, { status: 400 });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${origin}/${organization.slug}`,
  });

  return NextResponse.json({ url: session.url });
}









