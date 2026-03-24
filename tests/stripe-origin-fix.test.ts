import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { getStripeOrigin } from "../src/lib/stripe-origin";

/**
 * Tests for the Origin header security fix in Stripe routes.
 *
 * Security issue: Using req.headers.get("origin") for Stripe redirect URLs
 * allows attackers to spoof the Origin header and redirect users to malicious
 * sites after payment. The fix uses getStripeOrigin() which reads
 * NEXT_PUBLIC_SITE_URL (server-controlled), validates it, and falls back to
 * req.url origin.
 */

const SERVER_URL = "https://www.myteamnetwork.com/api/stripe/billing-portal";
const ENV_SITE_URL = "https://www.myteamnetwork.com";
const ATTACKER_ORIGIN = "https://evil.example.com";

describe("Stripe origin resolution — security fix (using real getStripeOrigin)", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.NEXT_PUBLIC_SITE_URL;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = savedEnv;
    }
  });

  it("uses NEXT_PUBLIC_SITE_URL when env var is set", () => {
    process.env.NEXT_PUBLIC_SITE_URL = ENV_SITE_URL;
    const origin = getStripeOrigin(SERVER_URL);
    assert.equal(origin, ENV_SITE_URL);
  });

  it("falls back to req.url origin when env var is unset", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const origin = getStripeOrigin(SERVER_URL);
    assert.equal(origin, "https://www.myteamnetwork.com");
  });

  it("never returns an attacker-controlled value (env var set)", () => {
    // Even if an attacker spoofs the Origin header, getStripeOrigin reads
    // from env/reqUrl — not from request headers.
    process.env.NEXT_PUBLIC_SITE_URL = ENV_SITE_URL;
    const origin = getStripeOrigin(SERVER_URL);
    assert.notEqual(origin, ATTACKER_ORIGIN);
    assert.equal(origin, ENV_SITE_URL);
  });

  it("never returns an attacker-controlled value (env var unset)", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const origin = getStripeOrigin(SERVER_URL);
    assert.notEqual(origin, ATTACKER_ORIGIN);
    assert.equal(origin, new URL(SERVER_URL).origin);
  });
});

describe("Stripe route files — no longer reference headers.get(\"origin\")", () => {
  const routeFiles = [
    "src/app/api/organizations/[organizationId]/start-checkout/route.ts",
    "src/app/api/stripe/create-donation/route.ts",
    "src/app/api/stripe/connect-onboarding/route.ts",
    "src/app/api/stripe/billing-portal/route.ts",
    "src/app/api/stripe/create-org-checkout/route.ts",
    "src/app/api/stripe/create-enterprise-checkout/route.ts",
  ];

  const repoRoot = path.resolve(import.meta.dirname ?? __dirname, "..");

  for (const relPath of routeFiles) {
    it(`${relPath} does not contain headers.get("origin")`, () => {
      const absPath = path.join(repoRoot, relPath);
      const content = fs.readFileSync(absPath, "utf-8");
      assert.ok(
        !content.includes(`headers.get("origin")`),
        `Expected no headers.get("origin") in ${relPath}`
      );
    });

    it(`${relPath} uses getStripeOrigin for safe origin resolution`, () => {
      const absPath = path.join(repoRoot, relPath);
      const content = fs.readFileSync(absPath, "utf-8");
      assert.ok(
        content.includes("getStripeOrigin"),
        `Expected getStripeOrigin in ${relPath}`
      );
    });
  }
});
