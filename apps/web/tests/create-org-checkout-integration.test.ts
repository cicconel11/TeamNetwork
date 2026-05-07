/**
 * Integration-style test for POST /api/stripe/create-org-checkout.
 *
 * Validates the full pipeline from curl-equivalent JSON payload → Zod
 * schema validation → origin resolution → Stripe-ready redirect URLs.
 *
 * This is the "curl test" regression guard: it proves that the exact env-var
 * values that caused the "Invalid URL" bug now produce valid redirect URLs.
 *
 * Manual curl equivalent (requires running server + auth cookie):
 *
 *   curl -X POST http://localhost:3000/api/stripe/create-org-checkout \
 *     -H "Content-Type: application/json" \
 *     -H "Cookie: sb-access-token=..." \
 *     -d '{
 *       "name": "My Organization",
 *       "slug": "my-org",
 *       "billingInterval": "month",
 *       "alumniBucket": "0-250",
 *       "idempotencyKey": "idem-12345678-abcd-1234-abcd-123456789abc"
 *     }'
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  baseSchemas,
  optionalSafeString,
  safeString,
} from "@/lib/security/validation";
import { getStripeOrigin } from "@/lib/stripe-origin";

// ── Schema (mirrors createOrgSchema in the route) ──────────────────────

const createOrgSchema = z
  .object({
    name: safeString(120),
    slug: baseSchemas.slug,
    description: optionalSafeString(800),
    primaryColor: baseSchemas.hexColor.optional(),
    billingInterval: z.enum(["month", "year"]),
    alumniBucket: z.enum([
      "none",
      "0-250",
      "251-500",
      "501-1000",
      "1001-2500",
      "2500-5000",
      "5000+",
    ]),
    withTrial: z.boolean().optional(),
    idempotencyKey: baseSchemas.idempotencyKey.optional(),
    paymentAttemptId: baseSchemas.uuid.optional(),
  })
  .strict();

// ── Helpers ─────────────────────────────────────────────────────────────

const REQ_URL =
  "https://teammeet-abc.vercel.app/api/stripe/create-org-checkout";

/** Build redirect URLs exactly as the route does (lines 331-332). */
function buildRedirectUrls(origin: string, slug: string) {
  return {
    success_url: `${origin}/app?org=${slug}&checkout=success`,
    cancel_url: `${origin}/app?org=${slug}&checkout=cancel`,
  };
}

/** Assert a string is a parseable URL (if `new URL()` doesn't throw, Stripe accepts it). */
function assertValidUrl(url: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    assert.fail(`${label} is not a valid URL: ${url}`);
    return; // unreachable, keeps TS happy
  }
  assert.ok(
    parsed.protocol === "https:" || parsed.protocol === "http:",
    `${label} must use http(s) protocol, got ${parsed.protocol}`,
  );
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("create-org-checkout integration — schema validation", () => {
  it("accepts a minimal curl-equivalent payload", () => {
    const payload = {
      name: "My Organization",
      slug: "my-org",
      billingInterval: "month" as const,
      alumniBucket: "0-250" as const,
    };
    const result = createOrgSchema.safeParse(payload);
    assert.ok(result.success, `Schema rejected minimal payload: ${JSON.stringify(result.error?.issues)}`);
  });

  it("accepts a fully-populated payload", () => {
    const payload = {
      name: "Greek Life Chapter",
      slug: "alpha-beta-gamma",
      description: "Our chapter's network hub",
      primaryColor: "#1e3a5f",
      billingInterval: "year" as const,
      alumniBucket: "501-1000" as const,
      withTrial: true,
      idempotencyKey: "idem-12345678-abcd-1234-abcd-123456789abc",
      paymentAttemptId: "12345678-abcd-1234-abcd-123456789abc",
    };
    const result = createOrgSchema.safeParse(payload);
    assert.ok(result.success, `Schema rejected full payload: ${JSON.stringify(result.error?.issues)}`);
  });

  it("rejects unknown fields (strict mode)", () => {
    const payload = {
      name: "My Org",
      slug: "my-org",
      billingInterval: "month",
      alumniBucket: "0-250",
      surpriseField: "hacker",
    };
    const result = createOrgSchema.safeParse(payload);
    assert.ok(!result.success, "Schema should reject unknown fields");
  });

  it("rejects an invalid slug (too short)", () => {
    const payload = {
      name: "My Org",
      slug: "ab",
      billingInterval: "month",
      alumniBucket: "0-250",
    };
    const result = createOrgSchema.safeParse(payload);
    assert.ok(!result.success);
  });

  it("normalizes uppercase slug to lowercase via transform", () => {
    const payload = {
      name: "My Org",
      slug: "My-Org",
      billingInterval: "month",
      alumniBucket: "0-250",
    };
    const result = createOrgSchema.safeParse(payload);
    assert.ok(result.success, "Schema should accept and lowercase the slug");
    assert.equal(result.data.slug, "my-org");
  });

  it("rejects an invalid billingInterval", () => {
    const payload = {
      name: "My Org",
      slug: "my-org",
      billingInterval: "weekly",
      alumniBucket: "0-250",
    };
    const result = createOrgSchema.safeParse(payload);
    assert.ok(!result.success);
  });

  it("rejects missing required fields", () => {
    const payload = { name: "My Org" };
    const result = createOrgSchema.safeParse(payload);
    assert.ok(!result.success);
  });
});

describe("create-org-checkout integration — redirect URL construction", () => {
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

  const envScenarios: Array<{
    label: string;
    envValue: string | undefined;
    expectedOrigin: string;
  }> = [
    {
      label: "clean production URL",
      envValue: "https://www.myteamnetwork.com",
      expectedOrigin: "https://www.myteamnetwork.com",
    },
    {
      label: "BUG REPRO — trailing newline (the original bug)",
      envValue: "https://www.myteamnetwork.com\n",
      expectedOrigin: "https://www.myteamnetwork.com",
    },
    {
      label: "trailing whitespace + newline",
      envValue: "  https://www.myteamnetwork.com  \n",
      expectedOrigin: "https://www.myteamnetwork.com",
    },
    {
      label: "trailing slash",
      envValue: "https://www.myteamnetwork.com/",
      expectedOrigin: "https://www.myteamnetwork.com",
    },
    {
      label: "missing protocol",
      envValue: "www.myteamnetwork.com",
      expectedOrigin: "https://www.myteamnetwork.com",
    },
    {
      label: "env var unset — falls back to req.url",
      envValue: undefined,
      expectedOrigin: "https://teammeet-abc.vercel.app",
    },
    {
      label: "env var empty string — falls back to req.url",
      envValue: "",
      expectedOrigin: "https://teammeet-abc.vercel.app",
    },
  ];

  for (const { label, envValue, expectedOrigin } of envScenarios) {
    it(`produces valid Stripe redirect URLs when env is: ${label}`, () => {
      if (envValue === undefined) {
        delete process.env.NEXT_PUBLIC_SITE_URL;
      } else {
        process.env.NEXT_PUBLIC_SITE_URL = envValue;
      }

      const origin = getStripeOrigin(REQ_URL);
      assert.equal(origin, expectedOrigin);

      // Build the exact URLs the route constructs (lines 331-332)
      const slug = "my-org";
      const { success_url, cancel_url } = buildRedirectUrls(origin, slug);

      // If these don't throw, Stripe will accept them
      assertValidUrl(success_url, "success_url");
      assertValidUrl(cancel_url, "cancel_url");

      // Verify query params survived
      const successParsed = new URL(success_url);
      assert.equal(successParsed.searchParams.get("org"), slug);
      assert.equal(successParsed.searchParams.get("checkout"), "success");

      const cancelParsed = new URL(cancel_url);
      assert.equal(cancelParsed.searchParams.get("org"), slug);
      assert.equal(cancelParsed.searchParams.get("checkout"), "cancel");
    });
  }
});

describe("create-org-checkout integration — end-to-end payload → URL pipeline", () => {
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

  it("regression: exact bug scenario — trailing newline env + valid payload → valid URLs", () => {
    // This is the exact condition that caused the user-reported bug
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.myteamnetwork.com\n";

    const payload = {
      name: "My Organization",
      slug: "my-org",
      billingInterval: "month" as const,
      alumniBucket: "0-250" as const,
      idempotencyKey: "idem-12345678-abcd-1234-abcd-123456789abc",
    };

    // Step 1: Payload passes schema validation
    const parsed = createOrgSchema.safeParse(payload);
    assert.ok(parsed.success, `Schema rejected payload: ${JSON.stringify(parsed.error?.issues)}`);

    // Step 2: Origin resolves cleanly despite trailing newline
    const origin = getStripeOrigin(REQ_URL);
    assert.equal(origin, "https://www.myteamnetwork.com");
    assert.ok(!origin.includes("\n"), "Origin must not contain newline");

    // Step 3: Redirect URLs are valid (Stripe won't reject them)
    const { success_url, cancel_url } = buildRedirectUrls(origin, parsed.data.slug);
    assertValidUrl(success_url, "success_url");
    assertValidUrl(cancel_url, "cancel_url");

    // Step 4: URLs point to the right place
    assert.ok(success_url.startsWith("https://www.myteamnetwork.com/app?"));
    assert.ok(cancel_url.startsWith("https://www.myteamnetwork.com/app?"));
  });

  it("slug with hyphens and numbers produces valid URLs", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.myteamnetwork.com";

    const payload = {
      name: "Alpha Beta 2024",
      slug: "alpha-beta-2024",
      billingInterval: "year" as const,
      alumniBucket: "251-500" as const,
      withTrial: true,
    };

    const parsed = createOrgSchema.safeParse(payload);
    assert.ok(parsed.success);

    const origin = getStripeOrigin(REQ_URL);
    const { success_url, cancel_url } = buildRedirectUrls(origin, parsed.data.slug);

    assertValidUrl(success_url, "success_url");
    assertValidUrl(cancel_url, "cancel_url");
    assert.ok(success_url.includes("org=alpha-beta-2024"));
  });
});
