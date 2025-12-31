import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { requireEnv } from "@/lib/env";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");

export async function POST(req: Request) {
  console.log("[stripe-webhook] Received request");
  
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    console.log("[stripe-webhook] Missing stripe-signature header");
    return NextResponse.json({ error: "Missing webhook secret" }, { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    console.log("[stripe-webhook] Event received:", event.type, event.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    console.error("[stripe-webhook] Signature verification failed:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const supabase: SupabaseClient<Database, "public"> = createServiceClient();

  type OrgSubUpdate = Database["public"]["Tables"]["organization_subscriptions"]["Update"];
  const orgSubs = () =>
    // Encapsulated cast: Supabase typings can be strict with update payload inference.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.from("organization_subscriptions") as any;

  const applyUpdate = async (
    match: { organization_id?: string; stripe_subscription_id?: string },
    data: Partial<Pick<OrgSubUpdate, "stripe_subscription_id" | "stripe_customer_id" | "status" | "current_period_end">>
  ) => {
    const payload = {
      ...data,
      updated_at: new Date().toISOString(),
    } satisfies Database["public"]["Tables"]["organization_subscriptions"]["Update"];

    let query = orgSubs().update(payload);
    if (match.organization_id) {
      query = query.eq("organization_id", match.organization_id);
    }
    if (match.stripe_subscription_id) {
      query = query.eq("stripe_subscription_id", match.stripe_subscription_id);
    }
    await query;
  };

  const updateByOrgId = async (
    organizationId: string,
    data: Partial<Pick<OrgSubUpdate, "stripe_subscription_id" | "stripe_customer_id" | "status" | "current_period_end">>
  ) => applyUpdate({ organization_id: organizationId }, data);

  const updateBySubscriptionId = async (
    subscriptionId: string,
    data: Partial<Pick<OrgSubUpdate, "stripe_customer_id" | "status" | "current_period_end">>
  ) => applyUpdate({ stripe_subscription_id: subscriptionId }, data);

  type DonationInsert = Database["public"]["Tables"]["organization_donations"]["Insert"];

  const upsertDonationRecord = async (params: {
    organizationId: string;
    paymentIntentId?: string | null;
    checkoutSessionId?: string | null;
    amountCents: number;
    currency?: string | null;
    donorName?: string | null;
    donorEmail?: string | null;
    eventId?: string | null;
    purpose?: string | null;
    metadata?: Stripe.Metadata | null;
    status: string;
  }) => {
    const payload: DonationInsert = {
      organization_id: params.organizationId,
      stripe_payment_intent_id: params.paymentIntentId ?? null,
      stripe_checkout_session_id: params.checkoutSessionId ?? null,
      amount_cents: params.amountCents,
      currency: (params.currency ?? "usd").toLowerCase(),
      donor_name: params.donorName ?? null,
      donor_email: params.donorEmail ?? null,
      event_id: params.eventId ?? null,
      purpose: params.purpose ?? null,
      metadata: params.metadata ?? null,
      status: params.status,
    };

    const conflictTarget = payload.stripe_payment_intent_id
      ? "stripe_payment_intent_id"
      : payload.stripe_checkout_session_id
        ? "stripe_checkout_session_id"
        : undefined;

    const query = conflictTarget
      ? supabase.from("organization_donations").upsert(payload, { onConflict: conflictTarget })
      : supabase.from("organization_donations").insert(payload);

    await query;
  };

  const incrementDonationStats = async (
    organizationId: string,
    amountCents: number,
    occurredAt: string | null,
    countDelta = 1
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).rpc("increment_donation_stats", {
      p_org_id: organizationId,
      p_amount_delta: amountCents,
      p_count_delta: countDelta,
      p_last: occurredAt ?? new Date().toISOString(),
    });
  };

  type SubscriptionWithPeriod = Stripe.Subscription & { current_period_end?: number | null };
  type InvoiceWithSub = Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
    customer?: string | Stripe.Customer | Stripe.DeletedCustomer | string | null;
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const organizationId = session.metadata?.organization_id;
      console.log("[stripe-webhook] checkout.session.completed - org:", organizationId, "session:", session.id);
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id || null;
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id || null;

      if (session.mode === "subscription" || subscriptionId) {
        if (!organizationId) break;

        let status = session.status || "completed";
        let currentPeriodEnd: string | null = null;

        if (subscriptionId) {
          const subscription = (await stripe.subscriptions.retrieve(subscriptionId)) as SubscriptionWithPeriod;
          if ("current_period_end" in subscription) {
            status = subscription.status;
            const periodEnd = Number(subscription.current_period_end);
            currentPeriodEnd = periodEnd
              ? new Date(periodEnd * 1000).toISOString()
              : null;
          }
        }

        console.log("[stripe-webhook] Updating subscription for org:", organizationId, { subscriptionId, customerId, status, currentPeriodEnd });
        await updateByOrgId(organizationId, {
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: customerId,
          status,
          current_period_end: currentPeriodEnd,
        });
        console.log("[stripe-webhook] Subscription updated successfully for org:", organizationId);
      } else if (session.mode === "payment" && organizationId) {
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id || null;
        const amountCents = session.amount_total ?? session.amount_subtotal ?? 0;

        await upsertDonationRecord({
          organizationId,
          paymentIntentId,
          checkoutSessionId: session.id,
          amountCents: amountCents ?? 0,
          currency: session.currency || "usd",
          donorName: session.customer_details?.name || (session.metadata?.donor_name ?? null),
          donorEmail: session.customer_details?.email || (session.metadata?.donor_email ?? null),
          eventId: session.metadata?.event_id || null,
          purpose: session.metadata?.purpose || null,
          metadata: session.metadata || null,
          status: session.payment_status || "processing",
        });
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as SubscriptionWithPeriod;
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id || null;
      const periodEnd = subscription.current_period_end ? Number(subscription.current_period_end) : 0;
      const currentPeriodEnd = periodEnd
        ? new Date(periodEnd * 1000).toISOString()
        : null;
      const status = subscription.status || "canceled";

      await updateBySubscriptionId(subscription.id, {
        status,
        current_period_end: currentPeriodEnd,
        stripe_customer_id: customerId,
      });
      break;
    }
    case "invoice.paid": {
      const invoice = event.data.object as InvoiceWithSub;
      const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : null;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
      if (subscriptionId) {
        const subscription = (await stripe.subscriptions.retrieve(subscriptionId)) as SubscriptionWithPeriod;
        const periodEnd = subscription.current_period_end ? Number(subscription.current_period_end) : 0;
        const currentPeriodEnd = periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : null;
        await updateBySubscriptionId(subscriptionId, {
          status: subscription.status,
          current_period_end: currentPeriodEnd,
          stripe_customer_id: customerId,
        });
      }
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as InvoiceWithSub;
      const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : null;
      if (subscriptionId) {
        await updateBySubscriptionId(subscriptionId, { status: "past_due" });
      }
      break;
    }

    // Donation payment intent handlers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const orgId = pi.metadata?.organization_id;
      if (!orgId) break;

      const amountSucceeded = pi.amount_received ?? pi.amount ?? 0;
      const occurredAt = pi.created ? new Date(pi.created * 1000).toISOString() : new Date().toISOString();

      await upsertDonationRecord({
        organizationId: orgId,
        paymentIntentId: pi.id,
        checkoutSessionId: (pi.metadata?.checkout_session_id as string | undefined) ?? null,
        amountCents: amountSucceeded,
        currency: pi.currency || "usd",
        donorName: pi.metadata?.donor_name || null,
        donorEmail: pi.receipt_email || pi.metadata?.donor_email || null,
        eventId: pi.metadata?.event_id || null,
        purpose: pi.metadata?.purpose || null,
        metadata: pi.metadata || null,
        status: "succeeded",
      });

      await incrementDonationStats(orgId, amountSucceeded, occurredAt, 1);
      break;
    }

    case "payment_intent.payment_failed": {
      const piFailed = event.data.object as Stripe.PaymentIntent;
      const orgIdFailed = piFailed.metadata?.organization_id;
      if (!orgIdFailed) break;

      const amountFailed = piFailed.amount ?? 0;
      await upsertDonationRecord({
        organizationId: orgIdFailed,
        paymentIntentId: piFailed.id,
        checkoutSessionId: (piFailed.metadata?.checkout_session_id as string | undefined) ?? null,
        amountCents: amountFailed,
        currency: piFailed.currency || "usd",
        donorName: piFailed.metadata?.donor_name || null,
        donorEmail: piFailed.receipt_email || piFailed.metadata?.donor_email || null,
        eventId: piFailed.metadata?.event_id || null,
        purpose: piFailed.metadata?.purpose || null,
        metadata: piFailed.metadata || null,
        status: "failed",
      });
      break;
    }

    default:
      // Ignore other events for now
      break;
  }

  return NextResponse.json({ received: true });
}
