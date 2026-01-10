import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { requireEnv } from "@/lib/env";
import type { AlumniBucket, Database, SubscriptionInterval } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markStripeEventProcessed, registerStripeEvent } from "@/lib/payments/stripe-events";
import { checkWebhookRateLimit, getWebhookClientIp } from "@/lib/security/webhook-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");

export async function POST(req: Request) {
  console.log("[stripe-webhook] Received request");

  // Rate limiting - defense in depth against compromised Stripe accounts or DoS
  const clientIp = getWebhookClientIp(req);
  if (clientIp) {
    const rateLimit = checkWebhookRateLimit(clientIp);
    if (!rateLimit.ok) {
      console.warn("[stripe-webhook] Rate limit exceeded for IP:", clientIp);
      return NextResponse.json(
        { error: "Too many requests", retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429, headers: rateLimit.headers }
      );
    }
  }
  
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

  const updatePaymentAttemptStatus = async (params: {
    paymentAttemptId?: string | null;
    paymentIntentId?: string | null;
    checkoutSessionId?: string | null;
    status?: string;
    lastError?: string | null;
    organizationId?: string | null;
    stripeConnectedAccountId?: string | null;
  }) => {
    const payload: Database["public"]["Tables"]["payment_attempts"]["Update"] = {
      updated_at: new Date().toISOString(),
    };

    if (typeof params.status === "string") payload.status = params.status;
    if (params.lastError !== undefined) payload.last_error = params.lastError;
    if (params.paymentIntentId !== undefined) payload.stripe_payment_intent_id = params.paymentIntentId;
    if (params.checkoutSessionId !== undefined) payload.stripe_checkout_session_id = params.checkoutSessionId;
    if (params.organizationId !== undefined) payload.organization_id = params.organizationId;
    if (params.stripeConnectedAccountId !== undefined) {
      payload.stripe_connected_account_id = params.stripeConnectedAccountId;
    }

    let query = supabase.from("payment_attempts").update(payload);
    if (params.paymentAttemptId) {
      query = query.eq("id", params.paymentAttemptId);
    } else if (params.paymentIntentId) {
      query = query.eq("stripe_payment_intent_id", params.paymentIntentId);
    } else if (params.checkoutSessionId) {
      query = query.eq("stripe_checkout_session_id", params.checkoutSessionId);
    } else {
      return;
    }

    const { error } = await query;
    if (error) {
      console.error("[stripe-webhook] Failed to update payment_attempt", error);
    }
  };

  type OrgMetadata = {
    organizationId: string | null;
    organizationSlug: string | null;
    organizationName: string | null;
    organizationDescription: string | null;
    organizationColor: string | null;
    createdBy: string | null;
    baseInterval: SubscriptionInterval;
    alumniBucket: AlumniBucket;
  };

  const normalizeInterval = (value?: string | null): SubscriptionInterval =>
    value === "year" ? "year" : "month";

  const normalizeBucket = (value?: string | null): AlumniBucket => {
    const allowed: AlumniBucket[] = ["none", "0-250", "251-500", "501-1000", "1001-2500", "2500-5000", "5000+"];
    return allowed.includes(value as AlumniBucket) ? (value as AlumniBucket) : "none";
  };

  const getSubscriptionStatus = (subscription: Stripe.Subscription | null | undefined): string => {
    if (!subscription) return "canceled";
    const status = subscription.status || "canceled";
    if (subscription.cancel_at_period_end && status !== "canceled") {
      return "canceling";
    }
    return status;
  };

  const parseOrgMetadata = (metadata?: Stripe.Metadata | null): OrgMetadata => ({
    organizationId: (metadata?.organization_id as string | undefined) ?? null,
    organizationSlug: (metadata?.organization_slug as string | undefined) ?? null,
    organizationName: (metadata?.organization_name as string | undefined) ?? null,
    organizationDescription: (metadata?.organization_description as string | undefined) ?? null,
    organizationColor: (metadata?.organization_color as string | undefined) ?? null,
    createdBy: (metadata?.created_by as string | undefined) ?? null,
    baseInterval: normalizeInterval((metadata?.base_interval as string | undefined) ?? null),
    alumniBucket: normalizeBucket((metadata?.alumni_bucket as string | undefined) ?? null),
  });

  const ensureOrganizationFromMetadata = async (metadata: OrgMetadata) => {
    if (!metadata.organizationId && !metadata.organizationSlug) return null;

    if (metadata.organizationId) {
      const { data: existingById } = await supabase
        .from("organizations")
        .select("id")
        .eq("id", metadata.organizationId)
        .maybeSingle();
      if (existingById?.id) return existingById.id;
    }

    if (metadata.organizationSlug) {
      const { data: existingBySlug } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", metadata.organizationSlug)
        .maybeSingle();
      if (existingBySlug?.id) return existingBySlug.id;
    }

    if (!metadata.organizationName || !metadata.organizationSlug) {
      console.warn("[stripe-webhook] Missing organization name/slug in metadata; cannot provision org");
      return null;
    }

    const { data: org, error: orgInsertError } = await supabase
      .from("organizations")
      .insert({
        id: metadata.organizationId ?? undefined,
        name: metadata.organizationName,
        slug: metadata.organizationSlug,
        description: metadata.organizationDescription || null,
        primary_color: metadata.organizationColor || "#1e3a5f",
      })
      .select("id")
      .single();

    if (orgInsertError || !org) {
      console.error("[stripe-webhook] Failed to provision organization from metadata", orgInsertError);
      return null;
    }

    if (metadata.createdBy) {
      await supabase
        .from("user_organization_roles")
        .upsert(
          {
            user_id: metadata.createdBy,
            organization_id: org.id,
            role: "admin",
            status: "active",
          },
          { onConflict: "organization_id,user_id" },
        );
    }

    return org.id;
  };

  const ensureSubscriptionSeed = async (orgId: string, metadata: OrgMetadata) => {
    const baseInterval = metadata.baseInterval || "month";
    const alumniBucket = metadata.alumniBucket || "none";
    const alumniPlanInterval = alumniBucket === "none" || alumniBucket === "5000+" ? null : baseInterval;

    const { data: existing } = await orgSubs()
      .select("id")
      .eq("organization_id", orgId)
      .maybeSingle();

    if (existing?.id) {
      const payload = {
        base_plan_interval: baseInterval,
        alumni_bucket: alumniBucket,
        alumni_plan_interval: alumniPlanInterval,
        status: "pending",
        updated_at: new Date().toISOString(),
      } satisfies Database["public"]["Tables"]["organization_subscriptions"]["Update"];

      await orgSubs()
        .update(payload)
        .eq("organization_id", orgId);
    } else {
      const insertPayload = {
        organization_id: orgId,
        base_plan_interval: baseInterval,
        alumni_bucket: alumniBucket,
        alumni_plan_interval: alumniPlanInterval,
        status: "pending",
      } satisfies Database["public"]["Tables"]["organization_subscriptions"]["Insert"];

      await orgSubs().insert(insertPayload);
    }
  };

  const resolveOrgForSubscriptionFlow = async (metadata: Stripe.Metadata | null | undefined) => {
    const parsed = parseOrgMetadata(metadata);
    const organizationId = await ensureOrganizationFromMetadata(parsed);
    if (organizationId) {
      await ensureSubscriptionSeed(organizationId, parsed);
    }
    return { organizationId, parsed };
  };

  const objectId =
    typeof event.data?.object === "object" && event.data?.object && "id" in event.data.object
      ? (event.data.object as { id?: string | null }).id
      : null;

  const extractAccountId = (value: string | Stripe.Account | null | undefined) =>
    typeof value === "string" ? value : value?.id || null;

  const eventRegistration = await registerStripeEvent({
    supabase,
    eventId: event.id,
    type: event.type,
    payload: {
      livemode: event.livemode,
      object_id: objectId,
    },
  });

  if (eventRegistration.alreadyProcessed) {
    console.log("[stripe-webhook] Duplicate event ignored:", event.id);
    return NextResponse.json({ received: true });
  }

  type SubscriptionWithPeriod = Stripe.Subscription & { current_period_end?: number | null };
  type InvoiceWithSub = Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
    customer?: string | Stripe.Customer | Stripe.DeletedCustomer | string | null;
  };

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id || null;
        const customerId =
          typeof session.customer === "string" ? session.customer : session.customer?.id || null;

        console.log("[stripe-webhook] checkout.session.completed - org:", session.metadata?.organization_id, "session:", session.id);

        if (session.mode === "subscription" || subscriptionId) {
          if (session.payment_status !== "paid") {
            console.warn("[stripe-webhook] Checkout completed without payment; skipping org provisioning");
            break;
          }

          const { organizationId } = await resolveOrgForSubscriptionFlow(session.metadata);
          if (!organizationId) {
            console.warn("[stripe-webhook] Missing organization info for checkout.session.completed");
            break;
          }

          let status = session.status || "completed";
          let currentPeriodEnd: string | null = null;

          if (subscriptionId) {
            const subscription = (await stripe.subscriptions.retrieve(subscriptionId)) as SubscriptionWithPeriod;
            if ("current_period_end" in subscription) {
              status = getSubscriptionStatus(subscription);
              const periodEnd = Number(subscription.current_period_end);
              currentPeriodEnd = periodEnd
                ? new Date(periodEnd * 1000).toISOString()
                : null;
            }
          }

          await updatePaymentAttemptStatus({
            paymentAttemptId: (session.metadata?.payment_attempt_id as string | undefined) ?? null,
            checkoutSessionId: session.id,
            paymentIntentId:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id || null,
            status: status === "complete" ? "succeeded" : status,
            organizationId,
          });

          console.log("[stripe-webhook] Updating subscription for org:", organizationId, { subscriptionId, customerId, status, currentPeriodEnd });
          await updateByOrgId(organizationId, {
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: customerId,
            status,
            current_period_end: currentPeriodEnd,
          });
          console.log("[stripe-webhook] Subscription updated successfully for org:", organizationId);
        } else if (session.mode === "payment") {
          const donationOrgId = session.metadata?.organization_id;
          if (!donationOrgId) break;

          const paymentIntentId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id || null;
          const amountCents = session.amount_total ?? session.amount_subtotal ?? 0;

          await updatePaymentAttemptStatus({
            paymentAttemptId: (session.metadata?.payment_attempt_id as string | undefined) ?? null,
            paymentIntentId,
            checkoutSessionId: session.id,
            status: session.payment_status || "processing",
            organizationId: donationOrgId,
            stripeConnectedAccountId: session.metadata?.destination || null,
          });

          await upsertDonationRecord({
            organizationId: donationOrgId,
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
        const status = getSubscriptionStatus(subscription);

        const shouldProvision = status !== "incomplete" && status !== "incomplete_expired";
        const { organizationId } = shouldProvision
          ? await resolveOrgForSubscriptionFlow(subscription.metadata)
          : { organizationId: null };
        if (organizationId) {
          await updateByOrgId(organizationId, {
            stripe_subscription_id: subscription.id,
            stripe_customer_id: customerId,
            status,
            current_period_end: currentPeriodEnd,
          });
        } else {
          await updateBySubscriptionId(subscription.id, {
            status,
            current_period_end: currentPeriodEnd,
            stripe_customer_id: customerId,
          });
        }
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
            status: getSubscriptionStatus(subscription),
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

        await updatePaymentAttemptStatus({
          paymentAttemptId: (pi.metadata?.payment_attempt_id as string | undefined) ?? null,
          paymentIntentId: pi.id,
          checkoutSessionId: (pi.metadata?.checkout_session_id as string | undefined) ?? null,
          status: "succeeded",
          organizationId: orgId,
          stripeConnectedAccountId:
            extractAccountId(pi.on_behalf_of) ||
            extractAccountId(pi.transfer_data?.destination) ||
            null,
        });

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
        await updatePaymentAttemptStatus({
          paymentAttemptId: (piFailed.metadata?.payment_attempt_id as string | undefined) ?? null,
          paymentIntentId: piFailed.id,
          checkoutSessionId: (piFailed.metadata?.checkout_session_id as string | undefined) ?? null,
          status: "failed",
          lastError: piFailed.last_payment_error?.message || piFailed.status || "failed",
          organizationId: orgIdFailed,
          stripeConnectedAccountId:
            extractAccountId(piFailed.on_behalf_of) ||
            extractAccountId(piFailed.transfer_data?.destination) ||
            null,
        });

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

    await markStripeEventProcessed(supabase, event.id);
    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook processing failed";
    console.error("[stripe-webhook] Handler error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
