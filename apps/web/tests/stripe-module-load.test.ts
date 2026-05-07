/**
 * Regression: `src/lib/stripe.ts` must load under `SKIP_STRIPE_VALIDATION=true`
 * with no Stripe env vars set.
 *
 * Next.js's `next build` runs a "Collect page data" phase that executes every
 * route module at build time. Any route that (transitively) imports
 * `@/lib/stripe` will crash the build if that module throws at load time in
 * CI, where Stripe secrets are not wired. See PR #51.
 *
 * If this test fails, someone added a new required env var to
 * `src/lib/stripe.ts` or `src/app/api/stripe/webhook/handler.ts` via bare
 * `requireEnv(...)` instead of `requireEnvOrDummy(...)`.
 */
import test from "node:test";
import assert from "node:assert/strict";

test("stripe module loads under SKIP_STRIPE_VALIDATION without any Stripe env vars", async () => {
  const priorSkip = process.env.SKIP_STRIPE_VALIDATION;
  const stripeKeys = Object.keys(process.env).filter(
    (k) => k.startsWith("STRIPE_") || k === "SUPABASE_SERVICE_ROLE_KEY",
  );
  const savedValues: Record<string, string | undefined> = {};
  for (const k of stripeKeys) {
    savedValues[k] = process.env[k];
    delete process.env[k];
  }
  process.env.SKIP_STRIPE_VALIDATION = "true";
  // Supabase public vars are still required — provide stubs.
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon_dummy";

  try {
    // Import via a cache-busting query string so this test is robust to the
    // module having been loaded earlier in the same process.
    const mod = await import(`../src/lib/stripe.ts?skip-validation-load-test`);
    assert.ok(mod.stripe, "expected stripe export to be present");
    assert.equal(typeof mod.getPriceIds, "function", "expected getPriceIds export");
  } finally {
    if (priorSkip === undefined) {
      delete process.env.SKIP_STRIPE_VALIDATION;
    } else {
      process.env.SKIP_STRIPE_VALIDATION = priorSkip;
    }
    for (const [k, v] of Object.entries(savedValues)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("webhook handler module loads under SKIP_STRIPE_VALIDATION without STRIPE_WEBHOOK_SECRET", async () => {
  const priorSkip = process.env.SKIP_STRIPE_VALIDATION;
  const priorWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  process.env.SKIP_STRIPE_VALIDATION = "true";
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon_dummy";

  try {
    const mod = await import(`../src/app/api/stripe/webhook/handler.ts?skip-validation-load-test`);
    assert.equal(typeof mod.handleStripeWebhookPost, "function");
  } finally {
    if (priorSkip === undefined) {
      delete process.env.SKIP_STRIPE_VALIDATION;
    } else {
      process.env.SKIP_STRIPE_VALIDATION = priorSkip;
    }
    if (priorWebhookSecret !== undefined) {
      process.env.STRIPE_WEBHOOK_SECRET = priorWebhookSecret;
    }
  }
});
