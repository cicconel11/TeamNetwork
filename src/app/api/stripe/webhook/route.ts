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

      if (!organizationId) {
        break;
      }

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

      // Check for duplicate (idempotency)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingSucceeded } = await (supabase as any)
        .from("organization_donations")
        .select("id")
        .eq("stripe_payment_intent_id", pi.id)
        .maybeSingle();
      if (existingSucceeded) break;

      const amountSucceeded = pi.amount_received ?? pi.amount ?? 0;
      const donorNameSucceeded = pi.metadata?.donor_name || null;
      const donorEmailSucceeded = pi.receipt_email || null;
      const eventIdSucceeded = pi.metadata?.event_id || null;
      const purposeSucceeded = pi.metadata?.purpose || null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("organization_donations").insert({
        organization_id: orgId,
        stripe_payment_intent_id: pi.id,
        amount_cents: amountSucceeded,
        donor_name: donorNameSucceeded,
        donor_email: donorEmailSucceeded,
        event_id: eventIdSucceeded || null,
        purpose: purposeSucceeded,
        status: "succeeded",
      });
      break;
    }

    case "payment_intent.payment_failed": {
      const piFailed = event.data.object as Stripe.PaymentIntent;
      const orgIdFailed = piFailed.metadata?.organization_id;
      if (!orgIdFailed) break;

      // Check for duplicate (idempotency)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingFailed } = await (supabase as any)
        .from("organization_donations")
        .select("id")
        .eq("stripe_payment_intent_id", piFailed.id)
        .maybeSingle();
      if (existingFailed) break;

      const amountFailed = piFailed.amount ?? 0;
      const donorNameFailed = piFailed.metadata?.donor_name || null;
      const donorEmailFailed = piFailed.receipt_email || null;
      const eventIdFailed = piFailed.metadata?.event_id || null;
      const purposeFailed = piFailed.metadata?.purpose || null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("organization_donations").insert({
        organization_id: orgIdFailed,
        stripe_payment_intent_id: piFailed.id,
        amount_cents: amountFailed,
        donor_name: donorNameFailed,
        donor_email: donorEmailFailed,
        event_id: eventIdFailed || null,
        purpose: purposeFailed,
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


