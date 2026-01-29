/**
 * Stripe mock utilities for API route testing.
 * Provides typed mock objects for simulating Stripe API responses.
 */

export interface MockStripeSubscription {
  id: string;
  status: "active" | "canceled" | "past_due" | "incomplete" | "trialing";
  customer: string;
  cancel_at_period_end: boolean;
  current_period_end: number;
  items: {
    data: Array<{
      id: string;
      price: { id: string; product: string };
    }>;
  };
  metadata?: Record<string, string>;
}

export interface MockStripeCheckoutSession {
  id: string;
  url: string;
  customer: string | null;
  subscription: string | null;
  payment_intent: string | null;
  mode: "subscription" | "payment";
  metadata?: Record<string, string>;
}

export interface MockStripePaymentIntent {
  id: string;
  status: "requires_payment_method" | "requires_confirmation" | "succeeded" | "canceled";
  amount: number;
  currency: string;
  customer: string | null;
  client_secret: string;
  metadata?: Record<string, string>;
}

export interface MockStripeCustomer {
  id: string;
  email: string | null;
  name: string | null;
  metadata?: Record<string, string>;
}

export interface MockStripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
  created: number;
}

export interface MockStripeAccount {
  id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
}

export interface MockStripeBillingPortalSession {
  id: string;
  url: string;
  customer: string;
  return_url: string;
}

/**
 * Create a mock Stripe subscription.
 */
export function createMockSubscription(
  overrides: Partial<MockStripeSubscription> = {}
): MockStripeSubscription {
  return {
    id: "sub_test123",
    status: "active",
    customer: "cus_test123",
    cancel_at_period_end: false,
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    items: {
      data: [
        {
          id: "si_test123",
          price: { id: "price_test123", product: "prod_test123" },
        },
      ],
    },
    ...overrides,
  };
}

/**
 * Create a mock Stripe checkout session.
 */
export function createMockCheckoutSession(
  overrides: Partial<MockStripeCheckoutSession> = {}
): MockStripeCheckoutSession {
  return {
    id: "cs_test123",
    url: "https://checkout.stripe.com/pay/cs_test123",
    customer: "cus_test123",
    subscription: "sub_test123",
    payment_intent: null,
    mode: "subscription",
    ...overrides,
  };
}

/**
 * Create a mock Stripe payment intent.
 */
export function createMockPaymentIntent(
  overrides: Partial<MockStripePaymentIntent> = {}
): MockStripePaymentIntent {
  return {
    id: "pi_test123",
    status: "succeeded",
    amount: 5000,
    currency: "usd",
    customer: "cus_test123",
    client_secret: "pi_test123_secret_xxx",
    ...overrides,
  };
}

/**
 * Create a mock Stripe customer.
 */
export function createMockCustomer(
  overrides: Partial<MockStripeCustomer> = {}
): MockStripeCustomer {
  return {
    id: "cus_test123",
    email: "customer@example.com",
    name: "Test Customer",
    ...overrides,
  };
}

/**
 * Create a mock Stripe webhook event.
 */
export function createMockWebhookEvent(
  type: string,
  data: Record<string, unknown>,
  overrides: Partial<MockStripeWebhookEvent> = {}
): MockStripeWebhookEvent {
  return {
    id: `evt_${Date.now()}`,
    type,
    data: { object: data },
    created: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

/**
 * Create a mock Stripe Connect account.
 */
export function createMockConnectAccount(
  overrides: Partial<MockStripeAccount> = {}
): MockStripeAccount {
  return {
    id: "acct_test123",
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    ...overrides,
  };
}

/**
 * Create a mock Stripe billing portal session.
 */
export function createMockBillingPortalSession(
  overrides: Partial<MockStripeBillingPortalSession> = {}
): MockStripeBillingPortalSession {
  return {
    id: "bps_test123",
    url: "https://billing.stripe.com/session/bps_test123",
    customer: "cus_test123",
    return_url: "https://example.com/settings",
    ...overrides,
  };
}

/**
 * Simulates Stripe webhook signature verification.
 * In tests, we accept any signature that starts with "valid_" and reject others.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  _secret: string // eslint-disable-line @typescript-eslint/no-unused-vars
): { valid: boolean; error?: string } {
  if (!signature) {
    return { valid: false, error: "No signature provided" };
  }
  if (signature.startsWith("valid_")) {
    return { valid: true };
  }
  return { valid: false, error: "Invalid signature" };
}

/**
 * Preset webhook events for common test scenarios.
 */
export const WebhookEventPresets = {
  checkoutCompleted: (metadata: Record<string, string> = {}) =>
    createMockWebhookEvent("checkout.session.completed", {
      id: "cs_test123",
      mode: "subscription",
      subscription: "sub_test123",
      customer: "cus_test123",
      metadata,
    }),

  subscriptionCreated: (subscriptionId: string = "sub_test123") =>
    createMockWebhookEvent("customer.subscription.created", {
      id: subscriptionId,
      status: "active",
      customer: "cus_test123",
      cancel_at_period_end: false,
    }),

  subscriptionUpdated: (subscriptionId: string = "sub_test123", status: string = "active") =>
    createMockWebhookEvent("customer.subscription.updated", {
      id: subscriptionId,
      status,
      customer: "cus_test123",
      cancel_at_period_end: false,
    }),

  subscriptionDeleted: (subscriptionId: string = "sub_test123") =>
    createMockWebhookEvent("customer.subscription.deleted", {
      id: subscriptionId,
      status: "canceled",
      customer: "cus_test123",
    }),

  invoicePaid: (subscriptionId: string = "sub_test123") =>
    createMockWebhookEvent("invoice.paid", {
      id: "in_test123",
      subscription: subscriptionId,
      customer: "cus_test123",
      amount_paid: 9900,
    }),

  invoicePaymentFailed: (subscriptionId: string = "sub_test123") =>
    createMockWebhookEvent("invoice.payment_failed", {
      id: "in_test123",
      subscription: subscriptionId,
      customer: "cus_test123",
      attempt_count: 1,
    }),

  paymentIntentSucceeded: (metadata: Record<string, string> = {}) =>
    createMockWebhookEvent("payment_intent.succeeded", {
      id: "pi_test123",
      amount: 5000,
      currency: "usd",
      metadata,
    }),
};

/**
 * Mock Stripe error responses.
 */
export const StripeErrors = {
  invalidRequest: {
    type: "invalid_request_error",
    message: "Invalid request",
    code: "invalid_request",
  },
  cardDeclined: {
    type: "card_error",
    message: "Your card was declined",
    code: "card_declined",
  },
  resourceMissing: {
    type: "invalid_request_error",
    message: "No such subscription",
    code: "resource_missing",
  },
  idempotencyKeyInUse: {
    type: "idempotency_error",
    message: "Keys for idempotent requests can only be used with the same parameters",
    code: "idempotency_key_in_use",
  },
};
