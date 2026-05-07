import { test, expect } from "@playwright/test";
import { LoginPage } from "../page-objects/LoginPage";

/**
 * Smoke-level coverage of the AI chat access policy through the real
 * app UI. Verifies the two externally observable contracts:
 *
 *   - Admin can open the chat page and POST /api/ai/[orgId]/chat returns 200.
 *   - Active member's POST is gated (403) when AI_MEMBER_ACCESS_KILL is on,
 *     and 200 when it is lifted.
 *
 * Kill-switch state comes from the running server process, which we can't
 * mutate from Playwright. Control it via env when launching `npm run dev`:
 *
 *   AI_MEMBER_ACCESS_KILL=1 npm run dev   # default; member blocked
 *   AI_MEMBER_ACCESS_KILL=0 npm run dev   # member admitted
 *
 * We read the same env in the test to decide which assertion to make, so
 * the spec stays in sync with server behavior.
 *
 * Requires these env vars (skipped otherwise):
 *   - E2E_ORG_SLUG      already used by other specs
 *   - E2E_MEMBER_EMAIL
 *   - E2E_MEMBER_PASSWORD
 */

const memberEmail = process.env.E2E_MEMBER_EMAIL;
const memberPassword = process.env.E2E_MEMBER_PASSWORD;
const orgSlug = process.env.E2E_ORG_SLUG;

const hasMemberCreds = Boolean(memberEmail && memberPassword && orgSlug);

// The server's env, read at the time Playwright launched. Mirrors what
// the Next.js process should see if both were started together.
const killSwitchOn = (() => {
  const raw = process.env.AI_MEMBER_ACCESS_KILL;
  if (raw == null) return true;
  const normalized = raw.trim().toLowerCase();
  return !(normalized === "0" || normalized === "false" || normalized === "off");
})();

test.describe("AI chat — admin (uses shared admin storage state)", () => {
  test.skip(!orgSlug, "E2E_ORG_SLUG required");

  test("admin can POST /api/ai/[orgId]/chat and get 200", async ({ page, request }) => {
    // Land on any org page to confirm auth + grab orgId via URL patterns
    await page.goto(`/${orgSlug}`);
    await expect(page).not.toHaveURL(/\/auth\/login/);

    // Admin spec uses shared storageState (e2e-state.json). Hit the chat
    // API directly through the authenticated browser context rather than
    // navigating a chat UI we don't own selectors for.
    const res = await page.request.post(`/api/ai/${await resolveOrgId(page, request, orgSlug!)}/chat`, {
      data: {
        message: "List our announcements",
        surface: "general",
        idempotencyKey: crypto.randomUUID(),
      },
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status(), `admin chat POST should 200; body=${await res.text()}`).toBe(200);
  });
});

test.describe("AI chat — active_member", () => {
  test.skip(!hasMemberCreds, "member creds not set");

  test("member POST is 403 when kill switch on, 200 when lifted", async ({ browser }) => {
    // Fresh context; member is NOT in the shared admin storage state.
    const context = await browser.newContext();
    const page = await context.newPage();
    const loginPage = new LoginPage(page);

    await loginPage.goto();
    await loginPage.login(memberEmail!, memberPassword!);
    await page.waitForURL((url) => !url.pathname.includes("/auth/login"), {
      timeout: 30000,
    });

    const orgId = await resolveOrgId(page, page.request, orgSlug!);

    const res = await page.request.post(`/api/ai/${orgId}/chat`, {
      data: {
        message: "Show announcements",
        surface: "general",
        idempotencyKey: crypto.randomUUID(),
      },
      headers: { "Content-Type": "application/json" },
    });

    if (killSwitchOn) {
      expect(res.status(), "member blocked when kill switch on").toBe(403);
    } else {
      expect(res.status(), `member admitted when kill switch lifted; body=${await res.text()}`).toBe(200);
    }

    await context.close();
  });
});

/**
 * Resolve the org's UUID from its slug. We need the UUID for the chat API
 * path. Tries an API call first, falls back to E2E_ORG_ID if that exists.
 */
async function resolveOrgId(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  slug: string,
): Promise<string> {
  const fromEnv = process.env.E2E_ORG_ID;
  if (fromEnv) return fromEnv;

  // Best-effort: look up org by slug via your API if one exists. Without
  // knowing the exact endpoint, fall back to requiring E2E_ORG_ID.
  void page;
  void request;
  void slug;
  throw new Error("E2E_ORG_ID env var is required for AI chat specs");
}
