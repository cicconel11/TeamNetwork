import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Missing webhook secret" }, { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
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

      await updateByOrgId(organizationId, {
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: customerId,
        status,
        current_period_end: currentPeriodEnd,
      });
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
    default:
      // Ignore other events for now
      break;
  }

  return NextResponse.json({ received: true });
}


