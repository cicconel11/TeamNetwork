import { test, expect, type BrowserContext, type Response } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TestData } from "../fixtures/test-data";
import {
  clearMentorshipRowsBetween,
  deleteChatGroupsBetween,
  getPair,
  getServiceClient,
  loginAsUser,
  mentorshipEnvMissing,
  seedProposedPair,
} from "../fixtures/mentorship-helpers";

/**
 * UI race test: same mentor has two browser contexts open on the Proposals
 * tab. One clicks Accept, the other clicks Decline nearly simultaneously.
 * Exactly one transition should win (200); the other should fail with a
 * conflict (409) — the server is the source of truth.
 *
 * Server truth: accept-vs-decline is mutually exclusive. Loser returns 409
 * per src/app/api/organizations/[organizationId]/mentorship/pairs/[pairId]/route.ts.
 * Idempotent repeated-accept is not tested here.
 *
 * Testids: per-pair `proposal-accept-<pairId>` / `proposal-decline-<pairId>` /
 * `proposal-confirm-decline-<pairId>`.
 */

const missing = mentorshipEnvMissing();
const orgSlug = TestData.getOrgSlug();
const CONFLICT_STATUS = 409;

test.describe("Mentorship: accept vs decline race (UI)", () => {
  test.skip(missing.length > 0, `Missing env: ${missing.join(", ")}`);
  test.describe.configure({ mode: "serial" });

  const orgId = TestData.getOrgId();
  const mentor = TestData.getMentorCredentials();
  const mentee = TestData.getMenteeCredentials();

  let supabase: SupabaseClient;
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    supabase = getServiceClient();
    // Two independent browser contexts logged in as the SAME mentor.
    ctxA = (await loginAsUser(browser, mentor.email, mentor.password)).context;
    ctxB = (await loginAsUser(browser, mentor.email, mentor.password)).context;
  });

  test.afterAll(async () => {
    await ctxA?.close();
    await ctxB?.close();
  });

  test.beforeEach(async () => {
    await clearMentorshipRowsBetween(supabase, {
      organizationId: orgId,
      mentorUserId: mentor.userId,
      menteeUserId: mentee.userId,
    });
    await deleteChatGroupsBetween(supabase, {
      organizationId: orgId,
      userAId: mentor.userId,
      userBId: mentee.userId,
    });
  });

  test("concurrent accept + decline: exactly one wins, the other conflicts", async () => {
    const pair = await seedProposedPair(supabase, {
      organizationId: orgId,
      mentorUserId: mentor.userId,
      menteeUserId: mentee.userId,
    });

    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await pageA.goto(`/${orgSlug}/mentorship?tab=proposals`);
    await pageB.goto(`/${orgSlug}/mentorship?tab=proposals`);

    const isPairPatch = (r: Response): boolean =>
      r.url().includes(`/mentorship/pairs/${pair.id}`) &&
      r.request().method() === "PATCH";

    const respAPromise = pageA.waitForResponse(isPairPatch, { timeout: 15000 });
    const respBPromise = pageB.waitForResponse(isPairPatch, { timeout: 15000 });

    const rowA = pageA.getByTestId(`incoming-proposal-${pair.id}`);
    const rowB = pageB.getByTestId(`incoming-proposal-${pair.id}`);
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();

    const acceptBtn = rowA.getByTestId(`proposal-accept-${pair.id}`);
    const declineBtn = rowB.getByTestId(`proposal-decline-${pair.id}`);
    await expect(acceptBtn).toBeVisible();
    await expect(declineBtn).toBeVisible();

    // Prime Page B's decline confirm form (without submitting yet).
    await declineBtn.click();
    const confirmDecline = rowB.getByTestId(`proposal-confirm-decline-${pair.id}`);
    await expect(confirmDecline).toBeVisible();

    // Fire nearly simultaneously.
    await Promise.all([acceptBtn.click(), confirmDecline.click()]);

    const [respA, respB] = await Promise.all([respAPromise, respBPromise]);
    const statuses = [respA.status(), respB.status()].sort((a, b) => a - b);

    // Exactly one 200 and one 409.
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    const loser = statuses.find((s) => s !== 200);
    expect(loser).toBe(CONFLICT_STATUS);

    // DB: pair resolved to either accepted or declined (not both, not still proposed).
    const persisted = (await getPair(supabase, pair.id)) as { status?: string } | null;
    expect(persisted?.status).toBeDefined();
    expect(["accepted", "declined"]).toContain(persisted?.status);

    await pageA.close();
    await pageB.close();
  });
});
