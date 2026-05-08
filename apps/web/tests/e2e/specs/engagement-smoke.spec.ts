import { test, expect, request } from "@playwright/test";

/**
 * Smoke tests for PR #206 (engagement: live activities + streaks/badges/digest +
 * reactions/mentions/presence).
 *
 * Two slices:
 *   1. Cron route auth — every cron endpoint added by the PR rejects callers
 *      without a Bearer CRON_SECRET. We don't try to invoke them with a real
 *      secret here; that belongs in a job, not an e2e run.
 *   2. /api/reactions auth + validation — the route requires an authenticated
 *      session, validates the JSON body strictly, and returns 404 for unknown
 *      targets. RLS does the actual authorization, so the e2e bar is "the
 *      surface plumbs through to RLS without crashing."
 */

const CRON_PATHS = [
  "/api/cron/streaks-recompute",
  "/api/cron/weekly-digest",
  "/api/cron/reengagement-sweep",
  "/api/cron/live-activity-end-stale",
];

test.describe("engagement cron auth", () => {
  for (const path of CRON_PATHS) {
    test(`${path} rejects unauthenticated GET`, async ({ baseURL }) => {
      const ctx = await request.newContext({ baseURL });
      const noAuth = await ctx.get(path);
      expect(noAuth.status(), `${path} no-auth`).toBe(401);

      const badAuth = await ctx.get(path, {
        headers: { authorization: "Bearer not-the-real-secret" },
      });
      expect(badAuth.status(), `${path} bad-auth`).toBe(401);
      await ctx.dispose();
    });
  }
});

test.describe("/api/reactions", () => {
  test("rejects unauthenticated POST", async ({ baseURL }) => {
    const ctx = await request.newContext({ baseURL });
    const res = await ctx.post("/api/reactions", {
      data: {
        target_kind: "chat_message",
        target_id: "00000000-0000-0000-0000-000000000000",
        emoji: "👍",
      },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test("rejects malformed payload when authenticated", async ({ page }) => {
    // The e2e project pre-authenticates via storageState — `page.request`
    // inherits those cookies, so this call is on behalf of the test user.
    const res = await page.request.post("/api/reactions", {
      data: { target_kind: "wrong_kind", target_id: "not-a-uuid", emoji: "" },
    });
    expect([400, 422]).toContain(res.status());
  });

  test("returns 404 for unknown target when authenticated", async ({ page }) => {
    const res = await page.request.post("/api/reactions", {
      data: {
        target_kind: "chat_message",
        target_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        emoji: "👍",
      },
    });
    expect(res.status()).toBe(404);
  });
});
