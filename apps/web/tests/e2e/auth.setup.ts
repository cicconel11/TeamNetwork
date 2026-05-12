import { test as setup, expect } from "@playwright/test";
import { TestData } from "./fixtures/test-data";

const authFile = "playwright/.auth/e2e-state.json";

/**
 * Authenticate as the E2E admin via Supabase admin-issued magic link.
 *
 * Password login is blocked by hCaptcha on the Supabase project, so we mint
 * a one-shot magiclink token with the service role key and navigate the
 * browser to /auth/confirm. This requires:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - E2E_ADMIN_EMAIL
 *   - E2E_ORG_SLUG (read via TestData.getOrgSlug())
 */
setup("authenticate as E2E admin", async ({ page }) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { email } = TestData.getAdminCredentials();
  const orgSlug = TestData.getOrgSlug();

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const res = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`generate_link failed: ${res.status} ${body}`);
  }

  const payload = (await res.json()) as {
    hashed_token?: string;
    properties?: { hashed_token?: string };
  };
  const hashedToken =
    payload.properties?.hashed_token ?? payload.hashed_token ?? null;
  if (!hashedToken) {
    throw new Error(`No hashed_token in generate_link response: ${JSON.stringify(payload)}`);
  }

  const confirmUrl = `/auth/confirm?token_hash=${encodeURIComponent(
    hashedToken
  )}&type=magiclink&next=${encodeURIComponent(`/${orgSlug}`)}`;

  await page.goto(confirmUrl);

  // After confirm, Supabase redirects somewhere authenticated — could be the
  // org page, /app, or /auth/reset-password (forced password setup flow).
  // Any non-/auth/(login|confirm) destination means the session cookie is set.
  await page.waitForURL(
    (url) => {
      const path = url.pathname;
      if (path.startsWith("/auth/login")) return false;
      if (path.startsWith("/auth/confirm")) return false;
      if (path.startsWith("/auth/error")) return false;
      return true;
    },
    { timeout: 30000 }
  );

  // Hop to the org home so the saved storageState reflects an authenticated
  // session that can reach org-scoped routes without redirect-to-login.
  await page.goto(`/${orgSlug}`);
  await page.waitForURL((url) => url.pathname.includes(orgSlug), { timeout: 30000 });

  expect(page.url()).not.toContain("/auth/login");

  await page.context().storageState({ path: authFile });
});
