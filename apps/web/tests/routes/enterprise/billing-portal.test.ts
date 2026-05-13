import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Tests for POST /api/enterprise/[enterpriseId]/billing/portal
 *
 * The billing portal route creates a Stripe billing portal session with a return_url.
 * Origin resolution is delegated to `getStripeOrigin(req.url)`, which prefers
 * the validated `NEXT_PUBLIC_SITE_URL` env var and falls back to the
 * server-controlled `req.url` origin. Attacker-controlled `Origin` headers are
 * never consulted.
 *
 * These simulation tests verify:
 * 1. NEXT_PUBLIC_SITE_URL is preferred when set
 * 2. Spoofed Origin headers are never used
 * 3. Fallback to req.url origin when env var unset
 * 4. Various error conditions (no Stripe customer, DB errors)
 */
import { getStripeOrigin } from "../../../src/lib/stripe-origin.ts";

// ── Types mirroring billing/portal/route.ts ─────────────────────────────────

interface SubscriptionRow {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

interface EnterpriseRow {
  slug: string;
}

interface PortalRouteParams {
  subscription: SubscriptionRow | null;
  subscriptionError: { message: string } | null;
  enterprise: EnterpriseRow | null;
  stripeRetrieveCustomerId: string | null;
  stripePortalUrl: string;
  envSiteUrl: string | undefined;
  reqUrl: string;
  reqOriginHeader: string | null;
}

interface PortalRouteResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Simulates POST billing/portal route logic (billing/portal/route.ts:15-104).
 *
 * Key behaviors:
 *   - subscriptionError → 500
 *   - no stripe_customer_id (and no stripe_subscription_id) → 400
 *   - enterprise not found → 404
 *   - success → return_url uses NEXT_PUBLIC_SITE_URL, NOT Origin header
 */
function simulatePortalRoute(params: PortalRouteParams): PortalRouteResult {
  const {
    subscription, subscriptionError, enterprise,
    stripeRetrieveCustomerId, stripePortalUrl,
    envSiteUrl, reqUrl, reqOriginHeader,
  } = params;

  if (subscriptionError) {
    return { status: 500, body: { error: "Internal server error" } };
  }

  let stripeCustomerId = subscription?.stripe_customer_id ?? null;

  if (!stripeCustomerId && subscription?.stripe_subscription_id) {
    stripeCustomerId = stripeRetrieveCustomerId;
  }

  if (!stripeCustomerId) {
    return { status: 400, body: { error: "Enterprise billing is not linked to Stripe yet." } };
  }

  if (!enterprise?.slug) {
    return { status: 404, body: { error: "Enterprise not found" } };
  }

  const prevSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = envSiteUrl;
  const origin = getStripeOrigin(reqUrl);
  if (prevSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = prevSiteUrl;

  void reqOriginHeader; // Origin header must never influence return_url

  const returnUrl = `${origin}/enterprise/${enterprise.slug}/billing`;

  return {
    status: 200,
    body: { url: stripePortalUrl, _returnUrl: returnUrl },
  };
}

// ── Origin header injection tests ───────────────────────────────────────────

describe("billing portal origin handling", () => {
  it("uses NEXT_PUBLIC_SITE_URL for return_url when env var is set", () => {
    const result = simulatePortalRoute({
      subscription: { stripe_customer_id: "cus_test", stripe_subscription_id: null },
      subscriptionError: null,
      enterprise: { slug: "test-enterprise" },
      stripeRetrieveCustomerId: null,
      stripePortalUrl: "https://billing.stripe.com/session/test",
      envSiteUrl: "https://www.myteamnetwork.com",
      reqUrl: "https://api.myteamnetwork.com/api/enterprise/ent-1/billing/portal",
      reqOriginHeader: "https://evil-phishing.com", // attacker-controlled
    });

    assert.strictEqual(result.status, 200);
    const returnUrl = result.body._returnUrl as string;
    assert.ok(
      returnUrl.startsWith("https://www.myteamnetwork.com/"),
      `return_url must use NEXT_PUBLIC_SITE_URL, got: ${returnUrl}`
    );
    assert.ok(
      !returnUrl.includes("evil-phishing"),
      "return_url must NOT use attacker-controlled Origin header"
    );
  });

  it("does NOT use spoofed Origin header even when NEXT_PUBLIC_SITE_URL is unset", () => {
    const result = simulatePortalRoute({
      subscription: { stripe_customer_id: "cus_test", stripe_subscription_id: null },
      subscriptionError: null,
      enterprise: { slug: "test-enterprise" },
      stripeRetrieveCustomerId: null,
      stripePortalUrl: "https://billing.stripe.com/session/test",
      envSiteUrl: undefined, // not set
      reqUrl: "https://api.myteamnetwork.com/api/enterprise/ent-1/billing/portal",
      reqOriginHeader: "https://evil-phishing.com",
    });

    assert.strictEqual(result.status, 200);
    const returnUrl = result.body._returnUrl as string;
    // Falls back to req.url origin (server-controlled), NOT the Origin header
    assert.ok(
      returnUrl.startsWith("https://api.myteamnetwork.com/"),
      `return_url must use req.url origin when env var unset, got: ${returnUrl}`
    );
    assert.ok(
      !returnUrl.includes("evil-phishing"),
      "return_url must NOT use attacker-controlled Origin header"
    );
  });

  it("return_url includes correct enterprise slug path", () => {
    const result = simulatePortalRoute({
      subscription: { stripe_customer_id: "cus_test", stripe_subscription_id: null },
      subscriptionError: null,
      enterprise: { slug: "acme-corp" },
      stripeRetrieveCustomerId: null,
      stripePortalUrl: "https://billing.stripe.com/session/test",
      envSiteUrl: "https://www.myteamnetwork.com",
      reqUrl: "https://api.myteamnetwork.com/api/enterprise/ent-1/billing/portal",
      reqOriginHeader: null,
    });

    assert.strictEqual(result.status, 200);
    const returnUrl = result.body._returnUrl as string;
    assert.ok(
      returnUrl.endsWith("/enterprise/acme-corp/billing"),
      `return_url must end with enterprise slug path, got: ${returnUrl}`
    );
  });
});

// ── Error handling tests ─────────────────────────────────────────────────────

describe("billing portal error handling", () => {
  it("returns 400 when no Stripe customer is linked", () => {
    const result = simulatePortalRoute({
      subscription: { stripe_customer_id: null, stripe_subscription_id: null },
      subscriptionError: null,
      enterprise: { slug: "test-enterprise" },
      stripeRetrieveCustomerId: null,
      stripePortalUrl: "https://billing.stripe.com/session/test",
      envSiteUrl: "https://www.myteamnetwork.com",
      reqUrl: "https://api.myteamnetwork.com/api/enterprise/ent-1/billing/portal",
      reqOriginHeader: null,
    });

    assert.strictEqual(result.status, 400);
    assert.ok((result.body.error as string).includes("not linked to Stripe"));
  });

  it("returns 500 on DB error fetching subscription", () => {
    const result = simulatePortalRoute({
      subscription: null,
      subscriptionError: { message: "connection timeout" },
      enterprise: { slug: "test-enterprise" },
      stripeRetrieveCustomerId: null,
      stripePortalUrl: "https://billing.stripe.com/session/test",
      envSiteUrl: "https://www.myteamnetwork.com",
      reqUrl: "https://api.myteamnetwork.com/api/enterprise/ent-1/billing/portal",
      reqOriginHeader: null,
    });

    assert.strictEqual(result.status, 500);
    assert.strictEqual(result.body.error, "Internal server error");
    // Must NOT contain the raw DB error message
    assert.ok(!(result.body.error as string).includes("connection timeout"));
  });

  it("returns 404 when enterprise not found", () => {
    const result = simulatePortalRoute({
      subscription: { stripe_customer_id: "cus_test", stripe_subscription_id: null },
      subscriptionError: null,
      enterprise: null,
      stripeRetrieveCustomerId: null,
      stripePortalUrl: "https://billing.stripe.com/session/test",
      envSiteUrl: "https://www.myteamnetwork.com",
      reqUrl: "https://api.myteamnetwork.com/api/enterprise/ent-1/billing/portal",
      reqOriginHeader: null,
    });

    assert.strictEqual(result.status, 404);
    assert.strictEqual(result.body.error, "Enterprise not found");
  });

  it("resolves Stripe customer from subscription when customer_id is null", () => {
    const result = simulatePortalRoute({
      subscription: { stripe_customer_id: null, stripe_subscription_id: "sub_test123" },
      subscriptionError: null,
      enterprise: { slug: "test-enterprise" },
      stripeRetrieveCustomerId: "cus_resolved", // retrieved from Stripe
      stripePortalUrl: "https://billing.stripe.com/session/test",
      envSiteUrl: "https://www.myteamnetwork.com",
      reqUrl: "https://api.myteamnetwork.com/api/enterprise/ent-1/billing/portal",
      reqOriginHeader: null,
    });

    // Should succeed because customer was resolved from subscription
    assert.strictEqual(result.status, 200);
  });
});
