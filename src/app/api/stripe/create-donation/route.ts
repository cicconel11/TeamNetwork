import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DonationMode = "checkout" | "payment_intent";

interface DonationRequest {
  organizationId?: string;
  organizationSlug?: string;
  amount: number;
  currency?: string;
  donorName?: string;
  donorEmail?: string;
  eventId?: string;
  purpose?: string;
  mode?: DonationMode;
}

export async function POST(req: Request) {
  const supabase = createServiceClient();

  let body: DonationRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const amountCents = Math.round(Number(body.amount || 0) * 100);
  if (!Number.isFinite(amountCents) || amountCents < 100) {
    return NextResponse.json({ error: "Amount must be at least $1.00" }, { status: 400 });
  }

  const currency = (body.currency || "usd").toLowerCase();
  const mode: DonationMode = body.mode === "payment_intent" ? "payment_intent" : "checkout";

  const orgFilter = body.organizationId
    ? { column: "id", value: body.organizationId }
    : body.organizationSlug
      ? { column: "slug", value: body.organizationSlug }
      : null;

  if (!orgFilter) {
    return NextResponse.json({ error: "organizationId or organizationSlug is required" }, { status: 400 });
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, slug, name, stripe_connect_account_id")
    .eq(orgFilter.column as "id" | "slug", orgFilter.value)
    .maybeSingle();

  if (orgError || !org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  if (!org.stripe_connect_account_id) {
    return NextResponse.json({ error: "Stripe is not connected for this organization" }, { status: 400 });
  }

  if (body.eventId) {
    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", body.eventId)
      .eq("organization_id", org.id)
      .maybeSingle();

    if (!event) {
      return NextResponse.json({ error: "Philanthropy event not found for this organization" }, { status: 404 });
    }
  }

  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  const donorName = body.donorName?.trim();
  const donorEmail = body.donorEmail?.trim();
  const purpose = body.purpose?.trim();
  const metadata: Record<string, string> = {
    organization_id: org.id,
    organization_slug: org.slug,
    flow: mode,
  };

  if (donorName) metadata.donor_name = donorName;
  if (donorEmail) metadata.donor_email = donorEmail;
  if (body.eventId) metadata.event_id = body.eventId;
  if (purpose) metadata.purpose = purpose;

  try {
    if (mode === "payment_intent") {
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency,
          automatic_payment_methods: { enabled: true },
          receipt_email: donorEmail || undefined,
          description: purpose ? `Donation: ${purpose}` : `Donation to ${org.name}`,
          metadata,
        },
        { stripeAccount: org.stripe_connect_account_id || undefined },
      );

      return NextResponse.json({
        mode,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
      });
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        submit_type: "donate",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: amountCents,
              product_data: {
                name: `Donation to ${org.name}`,
                metadata,
              },
            },
          },
        ],
        customer_email: donorEmail || undefined,
        metadata,
        payment_intent_data: {
          metadata,
          receipt_email: donorEmail || undefined,
        },
        success_url: `${origin}/${org.slug}/donations?donation=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/${org.slug}/donations?donation=cancelled`,
      },
      { stripeAccount: org.stripe_connect_account_id || undefined },
    );

    if (session.payment_intent && typeof session.payment_intent === "string") {
      await stripe.paymentIntents.update(
        session.payment_intent,
        { metadata: { ...metadata, checkout_session_id: session.id } },
        { stripeAccount: org.stripe_connect_account_id || undefined },
      );
    }

    return NextResponse.json({
      mode,
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start donation checkout";
    console.error("[create-donation] Error:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
