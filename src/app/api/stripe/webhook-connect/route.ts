import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { registerStripeEvent, markStripeEventProcessed } from "@/lib/payments/stripe-events";
import { checkWebhookRateLimit, getWebhookClientIp } from "@/lib/security/webhook-rate-limit";
import {
  upsertDonationRecord as defaultUpsertDonationRecord,
  incrementDonationStats as defaultIncrementDonationStats,
  updatePaymentAttemptStatus as defaultUpdatePaymentAttemptStatus,
  resolveDonorFromPaymentAttempt as defaultResolveDonorFromPaymentAttempt,
} from "@/lib/payments/webhook-handlers";
import { debugLog, maskPII } from "@/lib/debug";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ConnectWebhookDeps = {
  getWebhookSecret: () => string | undefined;
  getClientIp: typeof getWebhookClientIp;
  checkRateLimit: typeof checkWebhookRateLimit;
  parseEvent: (body: string, signature: string, secret: string) => Stripe.Event;
  createSupabase: typeof createServiceClient;
  registerEvent: typeof registerStripeEvent;
  markEventProcessed: typeof markStripeEventProcessed;
  upsertDonationRecord: typeof defaultUpsertDonationRecord;
  incrementDonationStats: typeof defaultIncrementDonationStats;
  updatePaymentAttemptStatus: typeof defaultUpdatePaymentAttemptStatus;
  resolveDonorFromPaymentAttempt: typeof defaultResolveDonorFromPaymentAttempt;
};

const defaultDeps: ConnectWebhookDeps = {
  getWebhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET_CONNECT,
  getClientIp: getWebhookClientIp,
  checkRateLimit: checkWebhookRateLimit,
  parseEvent: (body, signature, secret) => stripe.webhooks.constructEvent(body, signature, secret),
  createSupabase: createServiceClient,
  registerEvent: registerStripeEvent,
  markEventProcessed: markStripeEventProcessed,
  upsertDonationRecord: defaultUpsertDonationRecord,
  incrementDonationStats: defaultIncrementDonationStats,
  updatePaymentAttemptStatus: defaultUpdatePaymentAttemptStatus,
  resolveDonorFromPaymentAttempt: defaultResolveDonorFromPaymentAttempt,
};

async function handleConnectWebhook(req: Request, deps: ConnectWebhookDeps = defaultDeps) {
  const webhookSecret = deps.getWebhookSecret();

  // If no webhook secret configured, return 503
  if (!webhookSecret) {
    console.warn("[webhook-connect] STRIPE_WEBHOOK_SECRET_CONNECT not configured");
    return NextResponse.json({ error: "Connect webhook not configured" }, { status: 503 });
  }

  // Rate limiting (same pattern as main webhook)
  const clientIp = deps.getClientIp(req);
  if (clientIp) {
    const rateLimit = deps.checkRateLimit(clientIp);
    if (!rateLimit.ok) {
      console.warn("[webhook-connect] Rate limit exceeded for IP:", maskPII(clientIp));
      return NextResponse.json(
        { error: "Too many requests", retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429, headers: rateLimit.headers }
      );
    }
  }

  // Verify signature
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing webhook signature" }, { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = deps.parseEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    console.error("[webhook-connect] Signature verification failed:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Connect events MUST have event.account
  const connectedAccountId = (event as Stripe.Event & { account?: string }).account;
  if (!connectedAccountId) {
    console.warn("[webhook-connect] Received non-Connect event:", event.type);
    return NextResponse.json({ received: true });
  }

  const supabase = deps.createSupabase();

  // Helper: verify event.account matches org's stripe_connect_account_id
  async function verifyConnectAccount(organizationId: string): Promise<boolean> {
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("stripe_connect_account_id")
      .eq("id", organizationId)
      .maybeSingle();

    if (orgError) {
      throw new Error(`Failed to verify Connect account ownership: ${orgError.message}`);
    }

    if (!org?.stripe_connect_account_id) {
      console.error("[webhook-connect] Org has no connect account", { orgId: maskPII(organizationId) });
      return false;
    }

    if (org.stripe_connect_account_id !== connectedAccountId) {
      console.error("[SECURITY][webhook-connect] Connect account mismatch", {
        expected: maskPII(org.stripe_connect_account_id),
        received: maskPII(connectedAccountId),
        orgId: maskPII(organizationId),
      });
      return false;
    }

    return true;
  }

  try {
    // Dedup via stripe_events table
    const eventRegistration = await deps.registerEvent({
      supabase,
      eventId: event.id,
      type: event.type,
      payload: { livemode: event.livemode, connected_account: connectedAccountId },
    });

    if (eventRegistration.alreadyProcessed) {
      debugLog("webhook-connect", "Duplicate event ignored:", maskPII(event.id));
      return NextResponse.json({ received: true });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // Only handle payment mode (donations), not subscription mode
        if (session.mode !== "payment") {
          debugLog("webhook-connect", "Ignoring non-payment checkout session");
          break;
        }

        const orgId = session.metadata?.organization_id;
        if (!orgId) break;

        if (!(await verifyConnectAccount(orgId))) break;

        const paymentAttemptId = (session.metadata?.payment_attempt_id as string | undefined) ?? null;
        const paymentIntentId = typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null;
        const amountCents = session.amount_total ?? session.amount_subtotal ?? 0;
        const normalizedStatus = session.payment_status === "paid"
          ? "succeeded"
          : session.payment_status || "processing";

        const { error: paError } = await deps.updatePaymentAttemptStatus(supabase, {
          paymentAttemptId,
          paymentIntentId,
          checkoutSessionId: session.id,
          status: normalizedStatus,
          organizationId: orgId,
          stripeConnectedAccountId: connectedAccountId,
        });
        if (paError) {
          throw new Error(`Failed to update payment attempt: ${paError.message}`);
        }

        const donorFromAttempt = await deps.resolveDonorFromPaymentAttempt(supabase, paymentAttemptId);
        const { error: donationError } = await deps.upsertDonationRecord(supabase, {
          organizationId: orgId,
          paymentIntentId,
          checkoutSessionId: session.id,
          amountCents: amountCents ?? 0,
          currency: session.currency || "usd",
          donorName: session.customer_details?.name || donorFromAttempt.donorName,
          donorEmail: session.customer_details?.email || donorFromAttempt.donorEmail,
          eventId: session.metadata?.event_id || null,
          purpose: session.metadata?.purpose || null,
          metadata: session.metadata || null,
          status: normalizedStatus,
        });
        if (donationError) {
          throw new Error(`Failed to upsert donation record: ${donationError.message}`);
        }
        break;
      }

      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const orgId = pi.metadata?.organization_id;
        if (!orgId) break;

        if (!(await verifyConnectAccount(orgId))) break;

        const piPaymentAttemptId = (pi.metadata?.payment_attempt_id as string | undefined) ?? null;
        const amountSucceeded = pi.amount_received ?? pi.amount ?? 0;
        const occurredAt = pi.created ? new Date(pi.created * 1000).toISOString() : new Date().toISOString();

        const { error: paError } = await deps.updatePaymentAttemptStatus(supabase, {
          paymentAttemptId: piPaymentAttemptId,
          paymentIntentId: pi.id,
          checkoutSessionId: (pi.metadata?.checkout_session_id as string | undefined) ?? null,
          status: "succeeded",
          organizationId: orgId,
          stripeConnectedAccountId: connectedAccountId,
        });
        if (paError) {
          throw new Error(`Failed to update payment attempt: ${paError.message}`);
        }

        const piDonorInfo = await deps.resolveDonorFromPaymentAttempt(supabase, piPaymentAttemptId);
        const { error: donationError } = await deps.upsertDonationRecord(supabase, {
          organizationId: orgId,
          paymentIntentId: pi.id,
          checkoutSessionId: (pi.metadata?.checkout_session_id as string | undefined) ?? null,
          amountCents: amountSucceeded,
          currency: pi.currency || "usd",
          donorName: piDonorInfo.donorName,
          donorEmail: pi.receipt_email || piDonorInfo.donorEmail,
          eventId: pi.metadata?.event_id || null,
          purpose: pi.metadata?.purpose || null,
          metadata: pi.metadata || null,
          status: "succeeded",
        });
        if (donationError) {
          throw new Error(`Failed to upsert donation record: ${donationError.message}`);
        }

        const { error: statsError } = await deps.incrementDonationStats(supabase, orgId, amountSucceeded, occurredAt, 1);
        if (statsError) {
          throw new Error(`Failed to increment donation stats: ${statsError.message}`);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const piFailed = event.data.object as Stripe.PaymentIntent;
        const orgIdFailed = piFailed.metadata?.organization_id;
        if (!orgIdFailed) break;

        if (!(await verifyConnectAccount(orgIdFailed))) break;

        const piFailedAttemptId = (piFailed.metadata?.payment_attempt_id as string | undefined) ?? null;
        const amountFailed = piFailed.amount ?? 0;

        const { error: paError } = await deps.updatePaymentAttemptStatus(supabase, {
          paymentAttemptId: piFailedAttemptId,
          paymentIntentId: piFailed.id,
          checkoutSessionId: (piFailed.metadata?.checkout_session_id as string | undefined) ?? null,
          status: "failed",
          lastError: piFailed.last_payment_error?.message || piFailed.status || "failed",
          organizationId: orgIdFailed,
          stripeConnectedAccountId: connectedAccountId,
        });
        if (paError) {
          throw new Error(`Failed to update payment attempt: ${paError.message}`);
        }

        const piFailedDonorInfo = await deps.resolveDonorFromPaymentAttempt(supabase, piFailedAttemptId);
        const { error: donationError } = await deps.upsertDonationRecord(supabase, {
          organizationId: orgIdFailed,
          paymentIntentId: piFailed.id,
          checkoutSessionId: (piFailed.metadata?.checkout_session_id as string | undefined) ?? null,
          amountCents: amountFailed,
          currency: piFailed.currency || "usd",
          donorName: piFailedDonorInfo.donorName,
          donorEmail: piFailed.receipt_email || piFailedDonorInfo.donorEmail,
          eventId: piFailed.metadata?.event_id || null,
          purpose: piFailed.metadata?.purpose || null,
          metadata: piFailed.metadata || null,
          status: "failed",
        });
        if (donationError) {
          throw new Error(`Failed to upsert donation record: ${donationError.message}`);
        }
        break;
      }

      default:
        debugLog("webhook-connect", "Unhandled event type:", event.type);
        break;
    }

    await deps.markEventProcessed(supabase, event.id);
    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook processing failed";
    console.error("[webhook-connect] Handler error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handleConnectWebhook(req);
}
