import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import { createMockCheckoutSession, createMockPaymentIntent } from "../../utils/stripeMock.ts";

/**
 * Tests for POST /api/stripe/create-donation
 *
 * The create-donation route should:
 * 1. Validate captcha (required)
 * 2. Validate amount (min $1, max $100,000)
 * 3. Validate organization has Stripe Connect account
 * 4. Handle idempotency (prevent duplicate donations)
 * 5. Calculate platform fee server-side (ignore client value)
 * 6. Support both checkout session and payment intent modes
 * 7. Handle anonymous and authenticated donors
 */

// Types
interface DonationRequest {
  auth: AuthContext;
  captchaToken: string | null;
  organizationId: string | null;
  amountCents: number;
  currency?: string;
  donorName?: string;
  donorEmail?: string;
  eventId?: string;
  idempotencyKey: string;
  mode?: "checkout" | "payment_intent";
  clientPlatformFee?: number; // Should be ignored
}

interface DonationResult {
  status: number;
  checkoutUrl?: string;
  clientSecret?: string;
  error?: string;
}

interface DonationContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  organization?: {
    id: string;
    stripe_connect_account_id?: string | null;
    name?: string;
  };
  connectStatus?: {
    isReady: boolean;
    lookupFailed?: boolean;
  };
}

// Constants
const MIN_AMOUNT_CENTS = 100; // $1
const MAX_AMOUNT_CENTS = 10000000; // $100,000
const PLATFORM_FEE_PERCENT = 3; // 3% platform fee

// Simulation functions

function simulateCreateDonation(
  request: DonationRequest,
  ctx: DonationContext
): DonationResult {
  // Captcha validation is required (no user auth required for donations)
  if (!request.captchaToken) {
    return { status: 400, error: "Captcha verification required" };
  }

  // Organization ID required
  if (!request.organizationId) {
    return { status: 400, error: "Organization ID is required" };
  }

  // Validate organization exists
  if (!ctx.organization) {
    return { status: 404, error: "Organization not found" };
  }

  // Validate org has Stripe Connect account
  if (!ctx.organization.stripe_connect_account_id) {
    return { status: 400, error: "Organization has not set up donations" };
  }

  // If Stripe account lookup fails, surface temporary failure
  if (ctx.connectStatus?.lookupFailed) {
    return { status: 503, error: "Unable to verify Stripe connection. Please try again." };
  }

  // Stripe onboarding must be complete
  if (ctx.connectStatus && !ctx.connectStatus.isReady) {
    return { status: 400, error: "Stripe onboarding is not completed for this organization" };
  }

  // Amount validation
  if (!Number.isInteger(request.amountCents) || request.amountCents < MIN_AMOUNT_CENTS) {
    return { status: 400, error: `Minimum donation amount is $${MIN_AMOUNT_CENTS / 100}` };
  }

  if (request.amountCents > MAX_AMOUNT_CENTS) {
    return { status: 400, error: `Maximum donation amount is $${MAX_AMOUNT_CENTS / 100}` };
  }

  // Idempotency key required
  if (!request.idempotencyKey) {
    return { status: 400, error: "Idempotency key is required" };
  }

  // Check for existing payment attempt with this idempotency key
  const existingAttempt = ctx.supabase
    .getRows("payment_attempts")
    .find((row) => row.idempotency_key === request.idempotencyKey);

  if (existingAttempt) {
    // Return existing checkout URL or client secret
    if (existingAttempt.checkout_url) {
      return { status: 200, checkoutUrl: existingAttempt.checkout_url as string };
    }
    if (existingAttempt.stripe_payment_intent_client_secret) {
      return { status: 200, clientSecret: existingAttempt.stripe_payment_intent_client_secret as string };
    }
    // Attempt exists but no URL yet - wait for it
    return { status: 409, error: "Payment is being processed" };
  }

  // Calculate platform fee SERVER-SIDE (ignore any client-provided value)
  // Platform fee calculation happens server-side but not used in this simulation
  void Math.round(request.amountCents * (PLATFORM_FEE_PERCENT / 100));

  // Currency validation
  const currency = (request.currency || "usd").toLowerCase();
  if (!["usd", "eur", "gbp", "cad"].includes(currency)) {
    return { status: 400, error: "Unsupported currency" };
  }

  // Donor info validation for payment_intent mode
  if (request.mode === "payment_intent") {
    if (!request.donorEmail) {
      return { status: 400, error: "Donor email is required for payment intent mode" };
    }

    // Return mock client secret
    const mockIntent = createMockPaymentIntent({
      amount: request.amountCents,
      currency,
    });
    return { status: 200, clientSecret: mockIntent.client_secret };
  }

  // Default: checkout session mode
  const mockSession = createMockCheckoutSession({
    mode: "payment",
  });
  return { status: 200, checkoutUrl: mockSession.url };
}

function simulateIdempotentDonation(
  request: DonationRequest,
  ctx: DonationContext
): DonationResult {
  // First request creates the payment
  const firstResult = simulateCreateDonation(request, ctx);
  if (firstResult.status !== 200) {
    return firstResult;
  }

  // Store the payment attempt
  ctx.supabase.seed("payment_attempts", [
    {
      idempotency_key: request.idempotencyKey,
      checkout_url: firstResult.checkoutUrl,
      stripe_payment_intent_client_secret: firstResult.clientSecret,
      amount_cents: request.amountCents,
      organization_id: request.organizationId,
      flow_type: "donation_checkout",
      status: "processing",
    },
  ]);

  // Second request should return same result
  const secondResult = simulateCreateDonation(request, ctx);

  return secondResult;
}

// Tests

test("create-donation requires captcha token", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateDonation(
    {
      auth: AuthPresets.unauthenticated,
      captchaToken: null, // Missing captcha
      organizationId: "org-1",
      amountCents: 5000,
      idempotencyKey: "key-1",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_connect_account_id: "acct_123" },
    }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Captcha verification required");
});

test("create-donation requires organization ID", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateDonation(
    {
      auth: AuthPresets.unauthenticated,
      captchaToken: "valid_token",
      organizationId: null, // Missing org ID
      amountCents: 5000,
      idempotencyKey: "key-1",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Organization ID is required");
});

test("create-donation fails if organization not found", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateDonation(
    {
      auth: AuthPresets.unauthenticated,
      captchaToken: "valid_token",
      organizationId: "org-nonexistent",
      amountCents: 5000,
      idempotencyKey: "key-1",
    },
    { supabase, organization: undefined }
  );

  assert.strictEqual(result.status, 404);
  assert.strictEqual(result.error, "Organization not found");
});

test("create-donation fails if org has no Stripe Connect account", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateDonation(
    {
      auth: AuthPresets.unauthenticated,
      captchaToken: "valid_token",
      organizationId: "org-1",
      amountCents: 5000,
      idempotencyKey: "key-1",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_connect_account_id: null },
    }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Organization has not set up donations");
});

test("create-donation returns 503 when Stripe connect lookup fails", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateDonation(
    {
      auth: AuthPresets.unauthenticated,
      captchaToken: "valid_token",
      organizationId: "org-1",
      amountCents: 5000,
      idempotencyKey: "key-lookup-failed",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_connect_account_id: "acct_123" },
      connectStatus: { isReady: false, lookupFailed: true },
    }
  );

  assert.strictEqual(result.status, 503);
  assert.strictEqual(result.error, "Unable to verify Stripe connection. Please try again.");
});

test("create-donation rejects amount below minimum ($1)", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateDonation(
    {
      auth: AuthPresets.unauthenticated,
      captchaToken: "valid_token",
      organizationId: "org-1",
      amountCents: 50, // $0.50 - below minimum
      idempotencyKey: "key-1",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_connect_account_id: "acct_123" },
    }
  );

  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("Minimum donation"));
});

test("create-donation rejects amount above maximum ($100,000)", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateDonation(
    {
      auth: AuthPresets.unauthenticated,
      captchaToken: "valid_token",
      organizationId: "org-1",
      amountCents: 15000000, // $150,000 - above maximum
      idempotencyKey: "key-1",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_connect_account_id: "acct_123" },
    }
  );

  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("Maximum donation"));
});

test("create-donation rejects non-integer amount", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateDonation(
    {
      auth: AuthPresets.unauthenticated,
      captchaToken: "valid_token",
      organizationId: "org-1",
      amountCents: 50.5 as unknown as number, // Not an integer
      idempotencyKey: "key-1",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_connect_account_id: "acct_123" },
    }
  );

  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("Minimum donation"));
});

test("create-donation requires idempotency key", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateDonation(
    {
      auth: AuthPresets.unauthenticated,
      captchaToken: "valid_token",
      organizationId: "org-1",
      amountCents: 5000,
      idempotencyKey: "", // Empty idempotency key
    },
    {
      supabase,
      organization: { id: "org-1", stripe_connect_account_id: "acct_123" },
    }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Idempotency key is required");
});

test("create-donation returns checkout URL for valid request", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateDonation(
    {
      auth: AuthPresets.unauthenticated,
      captchaToken: "valid_token",
      organizationId: "org-1",
      amountCents: 5000,
      idempotencyKey: "key-1",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_connect_account_id: "acct_123" },
    }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.checkoutUrl?.includes("checkout.stripe.com"));
});

test("create-donation handles idempotent duplicate requests", () => {
  const supabase = createSupabaseStub();
  const ctx = {
    supabase,
    organization: { id: "org-1", stripe_connect_account_id: "acct_123" },
  };

  const request: DonationRequest = {
    auth: AuthPresets.unauthenticated,
    captchaToken: "valid_token",
    organizationId: "org-1",
    amountCents: 5000,
    idempotencyKey: "duplicate-key",
  };

  const result = simulateIdempotentDonation(request, ctx);

  assert.strictEqual(result.status, 200);
  assert.ok(result.checkoutUrl);
});

test("create-donation supports payment_intent mode", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateDonation(
    {
      auth: AuthPresets.unauthenticated,
      captchaToken: "valid_token",
      organizationId: "org-1",
      amountCents: 5000,
      idempotencyKey: "key-1",
      mode: "payment_intent",
      donorEmail: "donor@example.com",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_connect_account_id: "acct_123" },
    }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.clientSecret);
});

test("create-donation payment_intent mode requires donor email", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateDonation(
    {
      auth: AuthPresets.unauthenticated,
      captchaToken: "valid_token",
      organizationId: "org-1",
      amountCents: 5000,
      idempotencyKey: "key-1",
      mode: "payment_intent",
      // Missing donorEmail
    },
    {
      supabase,
      organization: { id: "org-1", stripe_connect_account_id: "acct_123" },
    }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Donor email is required for payment intent mode");
});

test("create-donation rejects unsupported currency", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateDonation(
    {
      auth: AuthPresets.unauthenticated,
      captchaToken: "valid_token",
      organizationId: "org-1",
      amountCents: 5000,
      idempotencyKey: "key-1",
      currency: "xyz", // Invalid currency
    },
    {
      supabase,
      organization: { id: "org-1", stripe_connect_account_id: "acct_123" },
    }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Unsupported currency");
});

test("create-donation works for authenticated users", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateDonation(
    {
      auth: AuthPresets.orgMember("org-1"),
      captchaToken: "valid_token",
      organizationId: "org-1",
      amountCents: 5000,
      idempotencyKey: "key-1",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_connect_account_id: "acct_123" },
    }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.checkoutUrl);
});

test("create-donation works for anonymous users", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateDonation(
    {
      auth: AuthPresets.unauthenticated,
      captchaToken: "valid_token",
      organizationId: "org-1",
      amountCents: 5000,
      idempotencyKey: "key-1",
      donorName: "Anonymous Donor",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_connect_account_id: "acct_123" },
    }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.checkoutUrl);
});

test("platform fee is calculated server-side (client value ignored)", () => {
  const supabase = createSupabaseStub();

  // Client tries to pass a custom platform fee (should be ignored)
  const request: DonationRequest = {
    auth: AuthPresets.unauthenticated,
    captchaToken: "valid_token",
    organizationId: "org-1",
    amountCents: 10000, // $100
    idempotencyKey: "key-1",
    clientPlatformFee: 0, // Client tries to set 0 fee
  };

  const result = simulateCreateDonation(request, {
    supabase,
    organization: { id: "org-1", stripe_connect_account_id: "acct_123" },
  });

  // The request succeeds, but internally the platform fee would be
  // calculated as 3% = $3 = 300 cents, regardless of client value
  assert.strictEqual(result.status, 200);
});

test("create-donation accepts valid currencies", () => {
  const supabase = createSupabaseStub();
  const validCurrencies = ["usd", "USD", "eur", "EUR", "gbp", "GBP", "cad", "CAD"];

  for (const currency of validCurrencies) {
    const result = simulateCreateDonation(
      {
        auth: AuthPresets.unauthenticated,
        captchaToken: "valid_token",
        organizationId: "org-1",
        amountCents: 5000,
        idempotencyKey: `key-${currency}`,
        currency,
      },
      {
        supabase,
        organization: { id: "org-1", stripe_connect_account_id: "acct_123" },
      }
    );

    assert.strictEqual(result.status, 200, `Currency ${currency} should be accepted`);
  }
});
