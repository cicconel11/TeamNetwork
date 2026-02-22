import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Tests for the Origin header security fix in Stripe routes.
 *
 * Security issue: Using req.headers.get("origin") for Stripe redirect URLs
 * allows attackers to spoof the Origin header and redirect users to malicious
 * sites after payment. The fix uses NEXT_PUBLIC_SITE_URL (server-controlled)
 * instead.
 */

// Resolved origin logic extracted from the 5 fixed routes — identical in each.
function resolveOrigin(
  reqUrl: string,
  envSiteUrl: string | undefined,
  _attackerOriginHeader: string | undefined
): string {
  // This is the exact post-fix pattern used in all 5 routes:
  //   const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  return envSiteUrl ?? new URL(reqUrl).origin;
}

// Pre-fix pattern (kept here only to confirm it's insecure by design)
function resolveOriginLegacy(
  reqUrl: string,
  _envSiteUrl: string | undefined,
  attackerOriginHeader: string | undefined
): string {
  return attackerOriginHeader ?? new URL(reqUrl).origin;
}

const SERVER_URL = "https://www.myteamnetwork.com/api/stripe/billing-portal";
const ENV_SITE_URL = "https://www.myteamnetwork.com";
const ATTACKER_ORIGIN = "https://evil.example.com";

describe("Stripe origin resolution — security fix", () => {
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
    const origin = resolveOrigin(SERVER_URL, process.env.NEXT_PUBLIC_SITE_URL, ATTACKER_ORIGIN);
    assert.equal(origin, ENV_SITE_URL);
  });

  it("falls back to new URL(req.url).origin when env var is unset", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const origin = resolveOrigin(SERVER_URL, process.env.NEXT_PUBLIC_SITE_URL, ATTACKER_ORIGIN);
    assert.equal(origin, "https://www.myteamnetwork.com");
  });

  it("ignores attacker-spoofed Origin header when env var is set", () => {
    process.env.NEXT_PUBLIC_SITE_URL = ENV_SITE_URL;
    const origin = resolveOrigin(SERVER_URL, process.env.NEXT_PUBLIC_SITE_URL, ATTACKER_ORIGIN);
    assert.notEqual(origin, ATTACKER_ORIGIN);
    assert.equal(origin, ENV_SITE_URL);
  });

  it("ignores attacker-spoofed Origin header when env var is unset (falls back to server URL)", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const origin = resolveOrigin(SERVER_URL, process.env.NEXT_PUBLIC_SITE_URL, ATTACKER_ORIGIN);
    assert.notEqual(origin, ATTACKER_ORIGIN);
    // Falls back to server-controlled URL origin
    assert.equal(origin, new URL(SERVER_URL).origin);
  });

  it("demonstrates why the legacy pattern was insecure: it uses the attacker header", () => {
    // This confirms the old code WAS vulnerable and the new code is NOT.
    const legacyOrigin = resolveOriginLegacy(SERVER_URL, ENV_SITE_URL, ATTACKER_ORIGIN);
    assert.equal(legacyOrigin, ATTACKER_ORIGIN, "Legacy pattern returns attacker-controlled value");

    const fixedOrigin = resolveOrigin(SERVER_URL, ENV_SITE_URL, ATTACKER_ORIGIN);
    assert.notEqual(fixedOrigin, ATTACKER_ORIGIN, "Fixed pattern ignores attacker-controlled value");
  });
});

describe("Stripe route files — no longer reference headers.get(\"origin\")", () => {
  const routeFiles = [
    "src/app/api/organizations/[organizationId]/start-checkout/route.ts",
    "src/app/api/stripe/create-donation/route.ts",
    "src/app/api/stripe/connect-onboarding/route.ts",
    "src/app/api/stripe/billing-portal/route.ts",
    "src/app/api/stripe/create-org-checkout/route.ts",
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

    it(`${relPath} uses NEXT_PUBLIC_SITE_URL for origin`, () => {
      const absPath = path.join(repoRoot, relPath);
      const content = fs.readFileSync(absPath, "utf-8");
      assert.ok(
        content.includes("process.env.NEXT_PUBLIC_SITE_URL"),
        `Expected NEXT_PUBLIC_SITE_URL in ${relPath}`
      );
    });
  }
});
