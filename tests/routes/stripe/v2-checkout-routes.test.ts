import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readSource(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("v2 Stripe checkout routes", () => {
  const orgRoute = readSource("src/app/api/stripe/create-org-v2-checkout/route.ts");
  const enterpriseRoute = readSource("src/app/api/stripe/create-enterprise-v2-checkout/route.ts");

  it("org v2 route validates auth, schema, slug collision, sales mode, checkout metadata, and idempotency", () => {
    assert.match(orgRoute, /if \(!user\)[\s\S]*Unauthorized/);
    assert.match(orgRoute, /validateJson\(req, createOrgV2Schema/);
    assert.match(orgRoute, /serviceSupabase[\s\S]*\.from\("organizations"\)[\s\S]*\.eq\("slug", slug\)/);
    assert.match(orgRoute, /Slug is already taken/);
    assert.match(orgRoute, /isSelfServeSalesLed\(\{ tier: "single"/);
    assert.match(orgRoute, /return respond\(\{ mode: "sales", organizationSlug: org\.slug \}\)/);
    assert.match(orgRoute, /flowType: "org_v2_checkout"/);
    assert.match(orgRoute, /type: "org_v2"/);
    assert.match(orgRoute, /payment_attempt_id: claimedAttempt\.id/);
    assert.match(orgRoute, /stripe\.checkout\.sessions\.create/);
    assert.match(orgRoute, /success_url: `\$\{origin\}\/app\?org=\$\{slug\}&checkout=success`/);
    assert.match(orgRoute, /cancel_url: `\$\{origin\}\/app\/create-org\?checkout=cancel`/);
  });

  it("enterprise v2 route validates auth, schema, slug collision, sales mode, checkout metadata, and idempotency", () => {
    assert.match(enterpriseRoute, /if \(!user\)[\s\S]*Unauthorized/);
    assert.match(enterpriseRoute, /validateJson\(req, createEnterpriseV2Schema/);
    assert.match(enterpriseRoute, /\.from\("enterprises"\)[\s\S]*\.eq\("slug", slug\)/);
    assert.match(enterpriseRoute, /\.from\("organizations"\)[\s\S]*\.eq\("slug", slug\)/);
    assert.match(enterpriseRoute, /Slug is already taken/);
    assert.match(enterpriseRoute, /isSelfServeSalesLed\(\{ tier: "enterprise"/);
    assert.match(enterpriseRoute, /return respond\(\{ mode: "sales", enterpriseSlug: ent\.slug \}\)/);
    assert.match(enterpriseRoute, /flowType: "enterprise_v2_checkout"/);
    assert.match(enterpriseRoute, /type: "enterprise_v2"/);
    assert.match(enterpriseRoute, /payment_attempt_id: claimedAttempt\.id/);
    assert.match(enterpriseRoute, /stripe\.checkout\.sessions\.create/);
    assert.match(enterpriseRoute, /success_url: `\$\{origin\}\/app\?enterprise=\$\{slug\}&checkout=success`/);
    assert.match(enterpriseRoute, /cancel_url: `\$\{origin\}\/app\/create-enterprise\?checkout=cancel`/);
  });

  it("org v2 route accepts Bearer auth via createAuthenticatedApiClient and exposes CORS preflight", () => {
    assert.match(orgRoute, /createAuthenticatedApiClient/);
    assert.doesNotMatch(
      orgRoute,
      /from "@\/lib\/supabase\/server"/,
      "v2 org route should no longer import cookie-only createClient",
    );
    assert.match(orgRoute, /export async function OPTIONS\(/);
    assert.match(orgRoute, /Access-Control-Allow-Origin/);
    assert.match(orgRoute, /Access-Control-Allow-Headers.*authorization/i);
    assert.match(
      orgRoute,
      /headers: \{ \.\.\.rateLimit\.headers, \.\.\.CORS_HEADERS \}/,
      "respond() must merge CORS_HEADERS into success/error JSON",
    );
  });

  it("middleware accepts Bearer tokens for /api/* and short-circuits OPTIONS", () => {
    const mw = readSource("src/middleware.ts");
    assert.match(mw, /pathname\.startsWith\("\/api\/"\)/);
    assert.match(mw, /request\.method === "OPTIONS"/);
    assert.match(mw, /\^Bearer \(eyJ\|sb_\)/);
    assert.match(mw, /tokenClient\.auth\.getUser\(token\)/);
  });

  it("createAuthenticatedApiClient prefers Bearer token, falls back to cookie client", () => {
    const api = readSource("src/lib/supabase/api.ts");
    assert.match(api, /\^Bearer \(\.\+\)\$/);
    assert.match(api, /Authorization: `Bearer \$\{token\}`/);
    assert.match(api, /createClient\(\)/);
    assert.match(api, /auth\.getUser\(token\)/);
  });

  it("v2 routes route catch-block errors through buildCheckoutErrorResponse (no generic 400 mask)", () => {
    for (const route of [orgRoute, enterpriseRoute]) {
      assert.match(route, /buildCheckoutErrorResponse\(error/);
      assert.doesNotMatch(
        route,
        /return respond\(\{ error: "Unable to start checkout" \}, 400\)/,
        "v2 route still returns generic 400 mask; should use buildCheckoutErrorResponse",
      );
    }
  });
});

describe("buildCheckoutErrorResponse", () => {
  it("classifies idempotency conflicts as 409, Stripe errors as 502, others as 500 with dev-only detail", async () => {
    const env = process.env as Record<string, string | undefined>;
    const prevEnv = env.NODE_ENV;
    const prevVerbose = env.STRIPE_VERBOSE_ERRORS;

    const { buildCheckoutErrorResponse } = await import("../../../src/lib/payments/stripe-error.ts");
    const { IdempotencyConflictError } = await import("../../../src/lib/payments/idempotency.ts");

    try {
      // dev-mode: detail leaks
      env.NODE_ENV = "development";
      delete env.STRIPE_VERBOSE_ERRORS;

      const idempRes = buildCheckoutErrorResponse(new IdempotencyConflictError("dup key"));
      assert.equal(idempRes.status, 409);
      const idempBody = await idempRes.json();
      assert.equal(idempBody.error, "dup key");
      assert.equal(idempBody.errorClass, "idempotency");

      const stripeErr = Object.assign(new Error("No such product: prod_X"), {
        type: "StripeInvalidRequestError",
      });
      const rawStripeErr = Object.assign(new Error("raw stripe failure"), {
        raw: { type: "invalid_request_error", requestId: "req_123" },
      });
      const stripeRes = buildCheckoutErrorResponse(stripeErr);
      assert.equal(stripeRes.status, 502);
      const stripeBody = await stripeRes.json();
      assert.equal(stripeBody.error, "Payment provider rejected the request");
      assert.equal(stripeBody.errorClass, "stripe");
      assert.equal(stripeBody.detail, "No such product: prod_X");
      assert.equal(buildCheckoutErrorResponse(rawStripeErr).status, 502);

      const internalRes = buildCheckoutErrorResponse(new Error("DB write failed"));
      assert.equal(internalRes.status, 500);
      const internalBody = await internalRes.json();
      assert.equal(internalBody.error, "Unable to start checkout");
      assert.equal(internalBody.errorClass, "internal");
      assert.equal(internalBody.detail, "DB write failed");

      // production without verbose flag: detail and class suppressed
      env.NODE_ENV = "production";
      delete env.STRIPE_VERBOSE_ERRORS;

      const prodStripeRes = buildCheckoutErrorResponse(stripeErr);
      const prodStripeBody = await prodStripeRes.json();
      assert.equal(prodStripeBody.detail, undefined);
      assert.equal(prodStripeBody.errorClass, undefined);
      const prodInternalRes = buildCheckoutErrorResponse(new Error("secret leak"));
      const prodInternalBody = await prodInternalRes.json();
      assert.equal(prodInternalBody.detail, undefined);
      assert.equal(prodInternalBody.errorClass, undefined);
    } finally {
      if (prevEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = prevEnv;
      if (prevVerbose === undefined) delete env.STRIPE_VERBOSE_ERRORS;
      else env.STRIPE_VERBOSE_ERRORS = prevVerbose;
    }
  });
});
