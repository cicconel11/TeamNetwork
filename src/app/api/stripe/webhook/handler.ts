/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { requireEnvOrDummy } from "@/lib/env";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markStripeEventProcessed, registerStripeEvent } from "@/lib/payments/stripe-events";
import { checkWebhookRateLimit, getWebhookClientIp } from "@/lib/security/webhook-rate-limit";
import {
  updatePaymentAttemptStatus,
} from "@/lib/payments/webhook-handlers";
import { calculateGracePeriodEnd } from "@/lib/subscription/grace-period";
import { createTelemetryReporter, reportExternalServiceWarning } from "@/lib/telemetry/server";
import { debugLog, maskPII } from "@/lib/debug";
import { createOrgProvisioner } from "@/lib/stripe/org-provisioner";
import { extractSubscriptionPeriodEndIso } from "@/lib/stripe/subscription-period";
import {
  buildRenewalReminderEmail,
  buildPaymentActionRequiredEmail,
  buildFinalizationFailedEmail,
  buildTrialEndingEmail,
} from "@/lib/stripe/invoice-email-templates";
import { sendEmail } from "@/lib/notifications";
import { sendInvoiceEmailToAdmins } from "@/lib/stripe/invoice-email-sender";
import type { BillingInterval } from "@/types/enterprise";
import { ALUMNI_BUCKET_PRICING } from "@/types/enterprise";
import {
  isOrgTrialMetadata,
  shouldProvisionOrgCheckoutOnCompletion,
} from "@/lib/subscription/org-trial";
// See src/lib/stripe.ts for the SKIP_STRIPE_VALIDATION rationale.
const webhookSecret = requireEnvOrDummy("STRIPE_WEBHOOK_SECRET", "whsec_ci_dummy");

export type StripeWebhookDeps = {
  stripeClient?: typeof stripe;
  createServiceClientFn?: typeof createServiceClient;
  sendEmailFn?: typeof sendEmail;
  createTelemetryReporterFn?: typeof createTelemetryReporter;
  getWebhookClientIpFn?: typeof getWebhookClientIp;
  checkWebhookRateLimitFn?: typeof checkWebhookRateLimit;
  webhookSecret?: string;
};

export async function handleStripeWebhookPost(
  req: Request,
  deps: StripeWebhookDeps = {}
) {
  const stripeClient = deps.stripeClient ?? stripe;
  const createServiceClientFn = deps.createServiceClientFn ?? createServiceClient;
  const sendEmailFn = deps.sendEmailFn ?? sendEmail;
  const createTelemetryReporterFn = deps.createTelemetryReporterFn ?? createTelemetryReporter;
  const getWebhookClientIpFn = deps.getWebhookClientIpFn ?? getWebhookClientIp;
  const checkWebhookRateLimitFn = deps.checkWebhookRateLimitFn ?? checkWebhookRateLimit;
  const webhookSigningSecret = deps.webhookSecret ?? webhookSecret;

  debugLog("stripe-webhook", "Received request");

  const telemetry = createTelemetryReporterFn({
    apiPath: "/api/stripe/webhook",
    method: "POST",
  });

  // Rate limiting - defense in depth against compromised Stripe accounts or DoS
  const clientIp = getWebhookClientIpFn(req);
  if (clientIp) {
    const rateLimit = checkWebhookRateLimitFn(clientIp);
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
    event = stripeClient.webhooks.constructEvent(body, signature, webhookSigningSecret);
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

  const supabase: SupabaseClient<Database, "public"> = createServiceClientFn();

  type OrgSubUpdate = Database["public"]["Tables"]["organization_subscriptions"]["Update"];
  const orgSubs = () =>
    // Encapsulated cast: Supabase typings can be strict with update payload inference.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.from("organization_subscriptions") as any;

  const applyUpdate = async (
    match: { organization_id?: string; stripe_subscription_id?: string },
    data: Partial<Pick<OrgSubUpdate, "stripe_subscription_id" | "stripe_customer_id" | "status" | "current_period_end" | "grace_period_ends_at" | "is_trial">>
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
    data: Partial<Pick<OrgSubUpdate, "stripe_subscription_id" | "stripe_customer_id" | "status" | "current_period_end" | "grace_period_ends_at" | "is_trial">>
  ) => applyUpdate({ organization_id: organizationId }, data);

  const updateBySubscriptionId = async (
    subscriptionId: string,
    data: Partial<Pick<OrgSubUpdate, "stripe_customer_id" | "status" | "current_period_end" | "grace_period_ends_at" | "is_trial">>
  ) => applyUpdate({ stripe_subscription_id: subscriptionId }, data);

  const {
    resolveOrgForSubscriptionFlow,
    validateOrgOwnsStripeResource,
  } = createOrgProvisioner({ supabase, debugLog });

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

  const formatStripeDateUtc = (unixSeconds: number) =>
    new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "long",
      day: "numeric",
    });


  /**
   * Handle enterprise subscription lifecycle updates.
   * Returns the enterprise subscription ID if found and updated, null otherwise.
   *
   * Updates alumni_bucket_quantity and sub_org_quantity from subscription metadata.
   */
  const handleEnterpriseSubscriptionUpdate = async (
    subscription: SubscriptionWithPeriod
  ): Promise<string | null> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: lookupError } = await (supabase as any)
      .from("enterprise_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subscription.id)
      .maybeSingle();

    if (lookupError) {
      throw new Error(`[handleEnterpriseSubscriptionUpdate] Lookup failed: ${lookupError.message}`);
    }

    if (!data) return null; // Not an enterprise subscription

    const currentPeriodEnd = extractSubscriptionPeriodEndIso(subscription);

    // Build update payload — only include quantities when metadata keys are
    // explicitly present.  When metadata is missing (e.g. Stripe dashboard edits
    // or non-plan-change events), preserve the existing DB values.
    const metadata = subscription.metadata;
    const updatePayload: Record<string, unknown> = {
      status: subscription.status,
      current_period_end: currentPeriodEnd,
      updated_at: new Date().toISOString(),
    };

    if (metadata?.alumni_bucket_quantity != null) {
      const parsed = parseInt(metadata.alumni_bucket_quantity, 10);
      if (parsed > 0) updatePayload.alumni_bucket_quantity = parsed;
    }
    if (metadata?.sub_org_quantity != null) {
      const parsed = parseInt(metadata.sub_org_quantity, 10);
      if (parsed > 0) updatePayload.sub_org_quantity = parsed;
    }

    debugLog("stripe-webhook", "Updating enterprise subscription:", {
      enterpriseSubId: data.id,
      ...(updatePayload.alumni_bucket_quantity != null && { alumniBucketQuantity: updatePayload.alumni_bucket_quantity }),
      ...(updatePayload.sub_org_quantity != null && { subOrgQuantity: updatePayload.sub_org_quantity }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase as any)
      .from("enterprise_subscriptions")
      .update(updatePayload)
      .eq("id", data.id);

    if (updateError) {
      throw new Error(`[handleEnterpriseSubscriptionUpdate] Update failed: ${updateError.message}`);
    }

    return data.id;
  };

  /**
   * Handle enterprise invoice payment failures.
   * Returns the enterprise subscription ID if found and updated, null otherwise.
   */
  const handleEnterprisePaymentFailed = async (
    subscriptionId: string
  ): Promise<string | null> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: lookupError } = await (supabase as any)
      .from("enterprise_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    if (lookupError) {
      throw new Error(`[handleEnterprisePaymentFailed] Lookup failed: ${lookupError.message}`);
    }

    if (!data) return null; // Not an enterprise subscription

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase as any)
      .from("enterprise_subscriptions")
      .update({
        status: "past_due",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);

    if (updateError) {
      throw new Error(`[handleEnterprisePaymentFailed] Update failed: ${updateError.message}`);
    }

    return data.id;
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

        debugLog("stripe-webhook", "checkout.session.completed - org:", maskPII(session.metadata?.organization_id), "session:", maskPII(session.id), "mode:", session.mode);

        // Handle enterprise checkout (subscription mode)
        if (session.metadata?.type === "enterprise") {
          const enterprisePaymentAttemptId =
            (session.metadata?.payment_attempt_id as string | undefined) ?? null;

          // Short-circuit if the attempt is already succeeded (duplicate
          // webhook delivery, provisioning already completed).
          if (enterprisePaymentAttemptId) {
            const { data: priorAttempt } = await supabase
              .from("payment_attempts")
              .select("status")
              .eq("id", enterprisePaymentAttemptId)
              .maybeSingle();
            if (priorAttempt?.status === "succeeded") {
              debugLog("stripe-webhook", "Enterprise attempt already succeeded; skipping reprovision");
              break;
            }
          }

          if (session.payment_status !== "paid") {
            debugLog("stripe-webhook", "Enterprise checkout completed without payment; skipping provisioning");
            break;
          }

          const creatorId = session.metadata.creatorId;
          const enterpriseName = session.metadata.enterpriseName;
          const enterpriseSlug = session.metadata.enterpriseSlug;
          const billingInterval = (session.metadata.billingInterval as BillingInterval) || "year";
          const billingContactEmail = session.metadata.billingContactEmail;
          const enterpriseDescription = session.metadata.enterpriseDescription;

          // Hybrid pricing quantities
          const alumniBucketQuantity = parseInt(session.metadata.alumni_bucket_quantity || "1", 10) || 1;
          const subOrgQuantity = parseInt(session.metadata.sub_org_quantity || "3", 10) || 3;

          if (!creatorId || !enterpriseName || !enterpriseSlug) {
            console.error("[stripe-webhook] Enterprise checkout missing required metadata", {
              eventId: maskPII(event.id),
              sessionId: maskPII(session.id),
              metadata: session.metadata,
            });
            if (enterprisePaymentAttemptId) {
              await updatePaymentAttemptStatus(supabase, {
                paymentAttemptId: enterprisePaymentAttemptId,
                status: "failed",
                lastError: "missing_required_metadata",
              });
            }
            return NextResponse.json(
              { error: "Enterprise provisioning failed - missing metadata" },
              { status: 500 }
            );
          }

          if (!enterprisePaymentAttemptId) {
            // Legacy in-flight sessions without payment_attempt_id — keep
            // provisioning idempotent via enterprise slug below and log so
            // we can tell how many are still in the wild.
            console.warn("[stripe-webhook] Enterprise checkout lacks payment_attempt_id; using legacy slug path", {
              eventId: maskPII(event.id),
              sessionId: maskPII(session.id),
              enterpriseSlug,
            });
          }

          debugLog("stripe-webhook", "Provisioning enterprise:", enterpriseSlug);

          // Create or reuse enterprise record (idempotent)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let { data: enterprise } = await (supabase as any)
            .from("enterprises")
            .select("*")
            .eq("slug", enterpriseSlug)
            .maybeSingle();

          if (!enterprise) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: created, error: enterpriseError } = await (supabase as any)
              .from("enterprises")
              .insert({
                name: enterpriseName,
                slug: enterpriseSlug,
                description: enterpriseDescription || null,
                billing_contact_email: billingContactEmail || null,
              })
              .select()
              .single();

            if (enterpriseError || !created) {
              console.error("[stripe-webhook] Failed to create enterprise", {
                eventId: maskPII(event.id),
                error: enterpriseError?.message,
                enterpriseSlug,
              });

              // If a duplicate insert raced, try one more fetch
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const { data: retry } = await (supabase as any)
                .from("enterprises")
                .select("*")
                .eq("slug", enterpriseSlug)
                .maybeSingle();

              if (!retry) {
                if (enterprisePaymentAttemptId) {
                  await updatePaymentAttemptStatus(supabase, {
                    paymentAttemptId: enterprisePaymentAttemptId,
                    status: "failed",
                    lastError: enterpriseError?.message || "enterprise_insert_failed",
                  });
                }
                return NextResponse.json(
                  { error: "Enterprise provisioning failed - will retry" },
                  { status: 500 }
                );
              }

              enterprise = retry;
            } else {
              enterprise = created;
            }
          } else if ((!enterprise.description && enterpriseDescription) || (!enterprise.billing_contact_email && billingContactEmail)) {
            // Opportunistically backfill missing fields on first successful checkout
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
              .from("enterprises")
              .update({
                ...(enterpriseDescription ? { description: enterpriseDescription } : {}),
                ...(billingContactEmail ? { billing_contact_email: billingContactEmail } : {}),
                updated_at: new Date().toISOString(),
              })
              .eq("id", enterprise.id);
          }

          // Create or update enterprise subscription
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: subError } = await (supabase as any)
            .from("enterprise_subscriptions")
            .upsert({
              enterprise_id: enterprise.id,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              billing_interval: billingInterval,
              alumni_bucket_quantity: alumniBucketQuantity,
              sub_org_quantity: subOrgQuantity,
              status: "active",
              updated_at: new Date().toISOString(),
            }, { onConflict: "enterprise_id" });

          if (subError) {
            console.error("[stripe-webhook] Failed to create enterprise subscription", {
              eventId: maskPII(event.id),
              error: subError.message,
              enterpriseId: enterprise.id,
            });
            if (enterprisePaymentAttemptId) {
              await updatePaymentAttemptStatus(supabase, {
                paymentAttemptId: enterprisePaymentAttemptId,
                status: "failed",
                lastError: subError.message || "subscription_insert_failed",
              });
            }
            return NextResponse.json(
              { error: "Enterprise subscription provisioning failed" },
              { status: 500 }
            );
          }

          // Grant owner role to creator (idempotent)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: roleError } = await (supabase as any)
            .from("user_enterprise_roles")
            .upsert({
              user_id: creatorId,
              enterprise_id: enterprise.id,
              role: "owner",
            }, { onConflict: "user_id,enterprise_id" });

          if (roleError) {
            console.error("[stripe-webhook] Failed to grant enterprise owner role", {
              eventId: maskPII(event.id),
              error: roleError.message,
              enterpriseId: enterprise.id,
              userId: creatorId,
            });
            // Don't fail - role can be granted manually
          }

          if (enterprisePaymentAttemptId) {
            await updatePaymentAttemptStatus(supabase, {
              paymentAttemptId: enterprisePaymentAttemptId,
              status: "succeeded",
              checkoutSessionId: session.id,
              metadataPatch: { provisioned_enterprise_id: enterprise.id },
            });
          }

          debugLog("stripe-webhook", "Enterprise provisioned successfully:", enterprise.id);
          break;
        }

        if (session.mode === "subscription" || subscriptionId) {
          if (!shouldProvisionOrgCheckoutOnCompletion(session.payment_status, session.metadata)) {
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

          // New-org checkout flows always carry payment_attempt_id and must grant
          // the purchaser an admin role. If that final write fails, return 500 so
          // Stripe retries the idempotent provisioning sequence instead of leaving
          // a paid org in a partially provisioned state.
          if (paymentAttemptId && !adminGranted) {
            console.error("[stripe-webhook] Failed to grant org admin role - forcing retry", {
              eventId: maskPII(event.id),
              organizationId: maskPII(organizationId),
              paymentAttemptId: maskPII(paymentAttemptId),
              sessionId: maskPII(session.id),
            });
            return NextResponse.json(
              { error: "Organization admin grant failed - will retry" },
              { status: 500 }
            );
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
              const subscription = (await stripeClient.subscriptions.retrieve(subscriptionId, {
                expand: ["items.data"],
              })) as SubscriptionWithPeriod;
              // Always use the actual subscription status from Stripe
              status = normalizeSubscriptionStatus(subscription);
              currentPeriodEnd = extractSubscriptionPeriodEndIso(subscription);
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
            is_trial: isOrgTrialMetadata(session.metadata),
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
        const currentPeriodEnd = extractSubscriptionPeriodEndIso(subscription);
        const status = normalizeSubscriptionStatus(subscription, event.type);


        // Check if this is an enterprise subscription first
        const enterpriseSubId = await handleEnterpriseSubscriptionUpdate(subscription);
        if (enterpriseSubId) {
          debugLog("stripe-webhook", "Enterprise subscription updated:", enterpriseSubId, { status });
          break;
        }

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
            is_trial: isOrgTrialMetadata(subscription.metadata),
            status,
            current_period_end: currentPeriodEnd,
            ...(gracePeriodUpdate !== undefined && { grace_period_ends_at: gracePeriodUpdate }),
          });
        } else {
          await updateBySubscriptionId(subscription.id, {
            is_trial: isOrgTrialMetadata(subscription.metadata),
            status,
            current_period_end: currentPeriodEnd,
            stripe_customer_id: customerId,
            ...(gracePeriodUpdate !== undefined && { grace_period_ends_at: gracePeriodUpdate }),
          });
        }
        break;
      }
      case "customer.subscription.trial_will_end": {
        const subscription = event.data.object as SubscriptionWithPeriod;
        const trialEnd = subscription.current_period_end
          ? formatStripeDateUtc(subscription.current_period_end)
          : "soon";

        await sendInvoiceEmailToAdmins(
          supabase,
          subscription.id,
          "trial ending reminder",
          (entityName) => buildTrialEndingEmail(trialEnd, { entityName }),
          sendEmailFn,
        );
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object as InvoiceWithSub;
        const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : null;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
        if (subscriptionId) {
          const subscription = (await stripeClient.subscriptions.retrieve(subscriptionId)) as SubscriptionWithPeriod;

          // Check if this is an enterprise subscription first
          const enterpriseSubId = await handleEnterpriseSubscriptionUpdate(subscription);
          if (enterpriseSubId) {
            debugLog("stripe-webhook", "Enterprise invoice paid, subscription updated:", enterpriseSubId);
            break;
          }

          // Fall back to organization subscription
          const currentPeriodEnd = extractSubscriptionPeriodEndIso(subscription);
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
          // Check if this is an enterprise subscription first
          const enterpriseSubId = await handleEnterprisePaymentFailed(subscriptionId);
          if (enterpriseSubId) {
            debugLog("stripe-webhook", "Enterprise payment failed, marked past_due:", enterpriseSubId);
            break;
          }
          // Fall back to organization subscription
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
            invoice = await stripeClient.invoices.retrieve(invoiceId) as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
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

          // Skip partial refunds — only cancel on full refund
          if (!charge.refunded) {
            debugLog("stripe-webhook", "Partial refund — not canceling subscription:", subscriptionId);
            break;
          }

          if (subscriptionId) {
            try {
              await stripeClient.subscriptions.cancel(subscriptionId);
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

      case "invoice.upcoming": {
        const upcomingInvoice = event.data.object as InvoiceWithSub;
        const upcomingSubId = typeof upcomingInvoice.subscription === "string" ? upcomingInvoice.subscription : null;
        if (!upcomingSubId) {
          debugLog("stripe-webhook", "invoice.upcoming without subscription, skipping");
          break;
        }
        const renewalDate = upcomingInvoice.period_end
          ? formatStripeDateUtc((upcomingInvoice as unknown as { period_end: number }).period_end)
          : "upcoming";
        const amountFormatted = typeof upcomingInvoice.amount_due === "number"
          ? `$${(upcomingInvoice.amount_due / 100).toFixed(2)}`
          : "your plan amount";
        await sendInvoiceEmailToAdmins(
          supabase,
          upcomingSubId,
          "renewal reminder",
          (entityName) => buildRenewalReminderEmail(renewalDate, amountFormatted, { entityName }),
          sendEmailFn
        );
        break;
      }

      case "invoice.payment_action_required": {
        const actionInvoice = event.data.object as InvoiceWithSub;
        const actionSubId = typeof actionInvoice.subscription === "string" ? actionInvoice.subscription : null;
        if (!actionSubId) {
          debugLog("stripe-webhook", "invoice.payment_action_required without subscription, skipping");
          break;
        }
        const hostedUrl = (actionInvoice as unknown as { hosted_invoice_url?: string | null }).hosted_invoice_url || "";
        await sendInvoiceEmailToAdmins(
          supabase,
          actionSubId,
          "payment action required",
          (entityName) => buildPaymentActionRequiredEmail(hostedUrl, { entityName }),
          sendEmailFn
        );
        break;
      }

      case "invoice.finalization_failed": {
        const failedInvoice = event.data.object as InvoiceWithSub;
        const failedSubId = typeof failedInvoice.subscription === "string" ? failedInvoice.subscription : null;
        if (!failedSubId) {
          debugLog("stripe-webhook", "invoice.finalization_failed without subscription, skipping");
          break;
        }
        const finalizationError = (failedInvoice as unknown as { last_finalization_error?: { message?: string } | null }).last_finalization_error;
        const errorMsg = finalizationError?.message ?? null;
        await sendInvoiceEmailToAdmins(
          supabase,
          failedSubId,
          "finalization failed",
          (entityName) => buildFinalizationFailedEmail(errorMsg, { entityName }),
          sendEmailFn
        );
        break;
      }

      case "invoice.created":
      case "invoice.finalized": {
        const logInvoice = event.data.object as InvoiceWithSub;
        const logSubId = typeof logInvoice.subscription === "string" ? logInvoice.subscription : null;
        debugLog("stripe-webhook", `${event.type} received for subscription:`, logSubId ? maskPII(logSubId) : "none");
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
