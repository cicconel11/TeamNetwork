import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { requireEnv } from "@/lib/env";
import type { AlumniBucket, Database, SubscriptionInterval } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markStripeEventProcessed, registerStripeEvent } from "@/lib/payments/stripe-events";
import { checkWebhookRateLimit, getWebhookClientIp } from "@/lib/security/webhook-rate-limit";
import {
  updatePaymentAttemptStatus,
} from "@/lib/payments/webhook-handlers";
import { calculateGracePeriodEnd } from "@/lib/subscription/grace-period";
import { createTelemetryReporter, reportExternalServiceWarning } from "@/lib/telemetry/server";
import { debugLog, maskPII } from "@/lib/debug";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");

export async function POST(req: Request) {
  debugLog("stripe-webhook", "Received request");

  const telemetry = createTelemetryReporter({
    apiPath: "/api/stripe/webhook",
    method: "POST",
  });

  // Rate limiting - defense in depth against compromised Stripe accounts or DoS
  const clientIp = getWebhookClientIp(req);
  if (clientIp) {
    const rateLimit = checkWebhookRateLimit(clientIp);
    if (!rateLimit.ok) {
      console.warn("[stripe-webhook] Rate limit exceeded for IP:", maskPII(clientIp));
      return NextResponse.json(
        { error: "Too many requests", retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429, headers: rateLimit.headers }
      );
    }
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    debugLog("stripe-webhook", "Missing stripe-signature header");
    return NextResponse.json({ error: "Missing webhook secret" }, { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    debugLog("stripe-webhook", "Event received:", event.type, maskPII(event.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    console.error("[stripe-webhook] Signature verification failed:", message);
    await telemetry.reportError(err, { phase: "signature_verification" });
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Guard: Connect events should be handled by /api/stripe/webhook-connect
  const connectedAccountId = (event as Stripe.Event & { account?: string }).account;
  if (connectedAccountId) {
    console.error("[stripe-webhook] Misrouted Connect event - expected /api/stripe/webhook-connect", {
      eventType: event.type,
      accountId: maskPII(connectedAccountId),
    });
    // Return non-2xx so Stripe retries until endpoint configuration is fixed.
    return NextResponse.json(
      { error: "Connect events must be sent to /api/stripe/webhook-connect" },
      { status: 500 }
    );
  }

  const supabase: SupabaseClient<Database, "public"> = createServiceClient();

  type OrgSubUpdate = Database["public"]["Tables"]["organization_subscriptions"]["Update"];
  const orgSubs = () =>
    // Encapsulated cast: Supabase typings can be strict with update payload inference.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.from("organization_subscriptions") as any;

  const applyUpdate = async (
    match: { organization_id?: string; stripe_subscription_id?: string },
    data: Partial<Pick<OrgSubUpdate, "stripe_subscription_id" | "stripe_customer_id" | "status" | "current_period_end" | "grace_period_ends_at">>
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
    const { error } = await query;
    if (error) {
      throw new Error(`Failed to update organization_subscriptions: ${error.message}`);
    }
  };

  const updateByOrgId = async (
    organizationId: string,
    data: Partial<Pick<OrgSubUpdate, "stripe_subscription_id" | "stripe_customer_id" | "status" | "current_period_end" | "grace_period_ends_at">>
  ) => applyUpdate({ organization_id: organizationId }, data);

  const updateBySubscriptionId = async (
    subscriptionId: string,
    data: Partial<Pick<OrgSubUpdate, "stripe_customer_id" | "status" | "current_period_end" | "grace_period_ends_at">>
  ) => applyUpdate({ stripe_subscription_id: subscriptionId }, data);

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

  const parseOrgMetadata = (metadata?: Stripe.Metadata | null): OrgMetadata => ({
    organizationId: (metadata?.organization_id as string | undefined) ?? null,
    organizationSlug: (metadata?.organization_slug as string | undefined) ?? null,
    organizationName: (metadata?.organization_name as string | undefined) ?? null,
    organizationDescription: (metadata?.organization_description as string | undefined) ?? null,
    organizationColor: (metadata?.organization_color as string | undefined) ?? null,
    // SECURITY FIX: Never trust created_by from Stripe metadata - will be resolved from payment_attempts
    createdBy: null,
    baseInterval: normalizeInterval((metadata?.base_interval as string | undefined) ?? null),
    alumniBucket: normalizeBucket((metadata?.alumni_bucket as string | undefined) ?? null),
  });

  const resolveCreatorFromPaymentAttempt = async (
    paymentAttemptId: string | null
  ): Promise<string | null> => {
    if (!paymentAttemptId) return null;

    const { data } = await supabase
      .from("payment_attempts")
      .select("user_id")
      .eq("id", paymentAttemptId)
      .maybeSingle();

    return data?.user_id ?? null;
  };

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
      debugLog("stripe-webhook", "Missing organization name/slug in metadata; cannot provision org");
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
      console.error("[stripe-webhook] Failed to provision organization from metadata", orgInsertError?.message);
      return null;
    }

    return org.id;
  };

  const grantAdminRole = async (organizationId: string, paymentAttemptId: string | null): Promise<boolean> => {
    const createdBy = await resolveCreatorFromPaymentAttempt(paymentAttemptId);
    if (createdBy) {
      console.warn("[SECURITY-AUDIT] Admin role granted via webhook", {
        organizationId: maskPII(organizationId),
        userId: maskPII(createdBy),
        paymentAttemptId: maskPII(paymentAttemptId),
        timestamp: new Date().toISOString(),
      });

      const { error } = await supabase
        .from("user_organization_roles")
        .upsert(
          {
            user_id: createdBy,
            organization_id: organizationId,
            role: "admin",
            status: "active",
          },
          { onConflict: "organization_id,user_id" },
        );
      
      if (error) {
        console.error("[stripe-webhook] Failed to grant admin role", {
          organizationId: maskPII(organizationId),
          userId: maskPII(createdBy),
          error: error.message,
        });
        return false;
      }
      return true;
    } else {
      console.error("[stripe-webhook] CRITICAL: No creator found in payment_attempts - org has no admin", {
        organizationId: maskPII(organizationId),
        paymentAttemptId: maskPII(paymentAttemptId),
      });
      return false;
    }
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

      const { error } = await orgSubs()
        .update(payload)
        .eq("organization_id", orgId);
      if (error) {
        throw new Error(`Failed to seed subscription row: ${error.message}`);
      }
    } else {
      const insertPayload = {
        organization_id: orgId,
        base_plan_interval: baseInterval,
        alumni_bucket: alumniBucket,
        alumni_plan_interval: alumniPlanInterval,
        status: "pending",
      } satisfies Database["public"]["Tables"]["organization_subscriptions"]["Insert"];

      const { error } = await orgSubs().insert(insertPayload);
      if (error) {
        throw new Error(`Failed to create subscription row: ${error.message}`);
      }
    }
  };

  const resolveOrgForSubscriptionFlow = async (
    metadata: Stripe.Metadata | null | undefined,
    paymentAttemptId?: string | null
  ): Promise<{ organizationId: string | null; parsed: OrgMetadata; adminGranted: boolean }> => {
    const parsed = parseOrgMetadata(metadata);
    const organizationId = await ensureOrganizationFromMetadata(parsed);
    let adminGranted = false;
    if (organizationId) {
      await ensureSubscriptionSeed(organizationId, parsed);
      // Grant admin role from verified payment_attempts, not from untrusted metadata
      if (paymentAttemptId) {
        adminGranted = await grantAdminRole(organizationId, paymentAttemptId);
      }
    }
    return { organizationId, parsed, adminGranted };
  };

  /**
   * Validates that webhook metadata matches the organization's Stripe resources.
   * Prevents cross-org subscription hijacking while allowing legitimate re-subscribe flows.
   */
  const validateOrgOwnsStripeResource = async (
    organizationId: string,
    stripeCustomerId: string | null,
    stripeSubscriptionId: string | null
  ): Promise<boolean> => {
    const { data: subscription } = await supabase
      .from("organization_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, organization_id, status")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!subscription) {
      return true; // New organization - no existing subscription
    }

    const status = subscription.status || "";
    const replaceableStatuses = ["canceled", "incomplete_expired"];
    const matchRequiredStatuses = ["unpaid", "past_due", "canceling"];
    const canReplaceIds = replaceableStatuses.includes(status);
    const requiresMatch = matchRequiredStatuses.includes(status);

    // If no existing Stripe IDs stored, allow the update
    if (!subscription.stripe_customer_id && !subscription.stripe_subscription_id) {
      return true;
    }

    // If subscription is fully inactive, allow new Stripe IDs (re-subscribe flow)
    if (canReplaceIds) {
      debugLog("stripe-webhook", "Allowing Stripe ID update for inactive subscription", {
        organizationId: maskPII(organizationId),
        status,
        oldCustomerId: maskPII(subscription.stripe_customer_id),
        newCustomerId: maskPII(stripeCustomerId),
      });
      return true;
    }

    // For unpaid/past_due/canceling subscriptions, require matching IDs
    if (requiresMatch) {
      if (subscription.stripe_customer_id) {
        if (!stripeCustomerId || subscription.stripe_customer_id !== stripeCustomerId) {
          console.error("[SECURITY] Stripe customer ID mismatch on troubled subscription", {
            organizationId: maskPII(organizationId),
            expected: maskPII(subscription.stripe_customer_id),
            provided: maskPII(stripeCustomerId),
            status,
          });
          return false;
        }
      }

      if (subscription.stripe_subscription_id && stripeSubscriptionId) {
        if (subscription.stripe_subscription_id !== stripeSubscriptionId) {
          console.error("[SECURITY] Stripe subscription ID mismatch on troubled subscription", {
            organizationId: maskPII(organizationId),
            expected: maskPII(subscription.stripe_subscription_id),
            provided: maskPII(stripeSubscriptionId),
            status,
          });
          return false;
        }
      }

      return true;
    }

    // For active subscriptions, validate IDs match
    if (subscription.stripe_customer_id && stripeCustomerId) {
      if (subscription.stripe_customer_id !== stripeCustomerId) {
        console.error("[SECURITY] Stripe customer ID mismatch on active subscription", {
          organizationId: maskPII(organizationId),
          expected: maskPII(subscription.stripe_customer_id),
          provided: maskPII(stripeCustomerId),
          status: subscription.status,
        });
        return false;
      }
    }

    if (subscription.stripe_subscription_id && stripeSubscriptionId) {
      if (subscription.stripe_subscription_id !== stripeSubscriptionId) {
        console.error("[SECURITY] Stripe subscription ID mismatch on active subscription", {
          organizationId: maskPII(organizationId),
          expected: maskPII(subscription.stripe_subscription_id),
          provided: maskPII(stripeSubscriptionId),
          status: subscription.status,
        });
        return false;
      }
    }

    return true;
  };

  const objectId =
    typeof event.data?.object === "object" && event.data?.object && "id" in event.data.object
      ? (event.data.object as { id?: string | null }).id
      : null;

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
    debugLog("stripe-webhook", "Duplicate event ignored:", maskPII(event.id));
    return NextResponse.json({ received: true });
  }

  type SubscriptionWithPeriod = Stripe.Subscription & {
    current_period_end?: number | null;
    cancel_at_period_end?: boolean | null;
  };
  type InvoiceWithSub = Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
    customer?: string | Stripe.Customer | Stripe.DeletedCustomer | string | null;
  };
  const normalizeSubscriptionStatus = (
    subscription: Pick<SubscriptionWithPeriod, "status" | "cancel_at_period_end">,
    eventType?: Stripe.Event.Type
  ) => {
    const status = subscription.status || "canceled";
    if (eventType === "customer.subscription.deleted") {
      return "canceled";
    }
    if (subscription.cancel_at_period_end && status !== "canceled") {
      return "canceling";
    }
    return status;
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

        debugLog("stripe-webhook", "checkout.session.completed - org:", maskPII(session.metadata?.organization_id), "session:", maskPII(session.id));

        if (session.mode === "subscription" || subscriptionId) {
          if (session.payment_status !== "paid") {
            debugLog("stripe-webhook", "Checkout completed without payment; skipping org provisioning");
            break;
          }

          const paymentAttemptId = (session.metadata?.payment_attempt_id as string | undefined) ?? null;
          const { organizationId, adminGranted } = await resolveOrgForSubscriptionFlow(session.metadata, paymentAttemptId);
          if (!organizationId) {
            // CRITICAL: Return 500 to force Stripe to retry - org provisioning failed
            console.error("[stripe-webhook] Failed to provision organization - forcing retry", {
              eventId: maskPII(event.id),
              sessionId: maskPII(session.id),
            });
            return NextResponse.json(
              { error: "Organization provisioning failed - will retry" },
              { status: 500 }
            );
          }

          // Log warning if admin role wasn't granted, but don't fail the webhook
          // The reconciliation endpoint can fix this, and user can contact support
          if (paymentAttemptId && !adminGranted) {
            console.error("[stripe-webhook] WARNING: Org created but admin role not granted", {
              eventId: maskPII(event.id),
              organizationId: maskPII(organizationId),
              paymentAttemptId: maskPII(paymentAttemptId),
              sessionId: maskPII(session.id),
            });
          }

          // SECURITY FIX: Validate org owns this Stripe resource
          const isValid = await validateOrgOwnsStripeResource(organizationId, customerId, subscriptionId);
          if (!isValid) {
            console.error("[SECURITY] Cross-org subscription hijacking attempt blocked", {
              eventId: maskPII(event.id),
              organizationId: maskPII(organizationId),
              customerId: maskPII(customerId),
              subscriptionId: maskPII(subscriptionId),
            });
            await markStripeEventProcessed(supabase, event.id);
            return NextResponse.json({ received: true });
          }

          // Always retrieve subscription status from Stripe when subscriptionId exists
          // Never use checkout session status ("complete") as subscription status
          let status = "active"; // Default fallback
          let currentPeriodEnd: string | null = null;

          if (subscriptionId) {
            try {
              const subscription = (await stripe.subscriptions.retrieve(subscriptionId)) as SubscriptionWithPeriod;
              // Always use the actual subscription status from Stripe
              status = normalizeSubscriptionStatus(subscription);
              const periodEnd = subscription.current_period_end ? Number(subscription.current_period_end) : null;
              currentPeriodEnd = periodEnd
                ? new Date(periodEnd * 1000).toISOString()
                : null;
            } catch (error) {
              console.error("[stripe-webhook] Failed to retrieve subscription:", maskPII(subscriptionId), error);
              await reportExternalServiceWarning(
                "stripe",
                `Failed to retrieve subscription ${subscriptionId} in checkout.session.completed`,
                telemetry.getContext(),
                { subscriptionId, eventType: event.type }
              );
              // If subscription retrieval fails, default to "active" for paid checkout
              status = "active";
            }
          } else {
            // This shouldn't happen for subscription mode, but if it does, default to active
            debugLog("stripe-webhook", "Checkout session completed but no subscription ID found");
            status = "active";
          }

          await updatePaymentAttemptStatus(supabase, {
            paymentAttemptId: (session.metadata?.payment_attempt_id as string | undefined) ?? null,
            checkoutSessionId: session.id,
            paymentIntentId:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id || null,
            status: status === "complete" ? "succeeded" : status,
            organizationId,
          });

          debugLog("stripe-webhook", "Updating subscription for org:", maskPII(organizationId), { status, currentPeriodEnd });
          await updateByOrgId(organizationId, {
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: customerId,
            status,
            current_period_end: currentPeriodEnd,
          });
          debugLog("stripe-webhook", "Subscription updated successfully for org:", maskPII(organizationId));
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
        const status = normalizeSubscriptionStatus(subscription, event.type);

        // Set grace period when subscription is deleted (canceled)
        // Clear grace period when subscription is reactivated (active/trialing)
        const isDeleted = event.type === "customer.subscription.deleted";
        const isReactivated = status === "active" || status === "trialing";
        
        let gracePeriodUpdate: string | null | undefined = undefined;
        if (isDeleted) {
          gracePeriodUpdate = calculateGracePeriodEnd();
        } else if (isReactivated) {
          // Clear any existing grace period when resubscribed
          gracePeriodUpdate = null;
        }

        const shouldProvision = status !== "incomplete" && status !== "incomplete_expired";
        const { organizationId } = shouldProvision
          ? await resolveOrgForSubscriptionFlow(subscription.metadata)
          : { organizationId: null };
        if (organizationId) {
          // SECURITY FIX: Validate org owns this Stripe resource
          const isValid = await validateOrgOwnsStripeResource(organizationId, customerId, subscription.id);
          if (!isValid) {
            console.error("[SECURITY] Cross-org subscription update blocked", {
              eventId: maskPII(event.id),
              organizationId: maskPII(organizationId),
              subscriptionId: maskPII(subscription.id),
            });
            await markStripeEventProcessed(supabase, event.id);
            return NextResponse.json({ received: true });
          }

          await updateByOrgId(organizationId, {
            stripe_subscription_id: subscription.id,
            stripe_customer_id: customerId,
            status,
            current_period_end: currentPeriodEnd,
            ...(gracePeriodUpdate !== undefined && { grace_period_ends_at: gracePeriodUpdate }),
          });
        } else {
          await updateBySubscriptionId(subscription.id, {
            status,
            current_period_end: currentPeriodEnd,
            stripe_customer_id: customerId,
            ...(gracePeriodUpdate !== undefined && { grace_period_ends_at: gracePeriodUpdate }),
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

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge & { invoice?: string | null };
        const invoiceId = typeof charge.invoice === "string" ? charge.invoice : null;

        if (invoiceId) {
          let invoice: (Stripe.Invoice & { subscription?: string | Stripe.Subscription | null }) | null = null;
          try {
            invoice = await stripe.invoices.retrieve(invoiceId) as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
          } catch (error) {
            console.error("[stripe-webhook] Failed to retrieve invoice:", maskPII(invoiceId), error);
            await reportExternalServiceWarning(
              "stripe",
              `Failed to retrieve invoice ${invoiceId} in charge.refunded`,
              telemetry.getContext(),
              { invoiceId, eventType: event.type }
            );
            break;
          }

          const subscriptionId = typeof invoice.subscription === "string"
            ? invoice.subscription : null;

          if (subscriptionId) {
            try {
              await stripe.subscriptions.cancel(subscriptionId);
            } catch {
              debugLog("stripe-webhook", "Subscription already cancelled or not found:", subscriptionId);
            }

            await updateBySubscriptionId(subscriptionId, {
              status: "canceled",
              grace_period_ends_at: calculateGracePeriodEnd(),
            });

            debugLog("stripe-webhook", "Refund detected — cancelled subscription:", subscriptionId);
          }
        }
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
    await telemetry.reportError(err, { phase: "event_processing", eventType: event.type, eventId: event.id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
