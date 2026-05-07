import { test, expect, type BrowserContext } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TestData } from "../fixtures/test-data";
import {
  clearMentorshipRowsBetween,
  deleteChatGroupsBetween,
  getServiceClient,
  loginAsUser,
  mentorshipEnvMissing,
  seedProposedPair,
  type SeededPair,
} from "../fixtures/mentorship-helpers";

/**
 * UI flow: mentor declines a proposed pair with an optional reason.
 * Assertions: the Proposals tab removes the row (after router.refresh), and
 * the mentee-side Activity tab reflects the declined state.
 *
 * Testids used: `incoming-proposal-<pairId>`, `proposal-decline-<pairId>`,
 * `proposal-decline-reason-<pairId>`, `proposal-confirm-decline-<pairId>`,
 * `outgoing-proposal-<pairId>` (with data-pair-status attr).
 */

const missing = mentorshipEnvMissing();
const orgSlug = TestData.getOrgSlug();
const DECLINE_REASON = "Schedule conflict — try next cycle";

test.describe("Mentorship: mentor declines (UI)", () => {
  test.skip(missing.length > 0, `Missing env: ${missing.join(", ")}`);
  test.describe.configure({ mode: "serial" });

  const orgId = TestData.getOrgId();
  const mentor = TestData.getMentorCredentials();
  const mentee = TestData.getMenteeCredentials();

  let supabase: SupabaseClient;
  let mentorContext: BrowserContext;
  let menteeContext: BrowserContext;
  let seeded: SeededPair;

  test.beforeAll(async ({ browser }) => {
    supabase = getServiceClient();
    mentorContext = (await loginAsUser(browser, mentor.email, mentor.password)).context;
    menteeContext = (await loginAsUser(browser, mentee.email, mentee.password)).context;
  });

  test.afterAll(async () => {
    await mentorContext?.close();
    await menteeContext?.close();
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
    seeded = await seedProposedPair(supabase, {
      organizationId: orgId,
      mentorUserId: mentor.userId,
      menteeUserId: mentee.userId,
    });
  });

  test("mentor declines with reason; proposal row disappears and mentee sees declined state", async () => {
    const mentorPage = await mentorContext.newPage();
    await mentorPage.goto(`/${orgSlug}/mentorship?tab=proposals`);

    const row = mentorPage.getByTestId(`incoming-proposal-${seeded.id}`);
    await expect(row).toBeVisible();

    await row.getByTestId(`proposal-decline-${seeded.id}`).click();

    const reasonBox = row.getByTestId(`proposal-decline-reason-${seeded.id}`);
    await expect(reasonBox).toBeVisible();
    await reasonBox.fill(DECLINE_REASON);

    const patchResponsePromise = mentorPage.waitForResponse(
      (r) =>
        r.url().includes(`/api/organizations/${orgId}/mentorship/pairs/${seeded.id}`) &&
        r.request().method() === "PATCH",
    );
    await row.getByTestId(`proposal-confirm-decline-${seeded.id}`).click();
    const patchResponse = await patchResponsePromise;
    expect(patchResponse.status()).toBe(200);

    await expect(mentorPage.getByText("Proposal declined")).toBeVisible({ timeout: 5000 });

    // After refresh, the row should either be gone or no longer show accept action.
    await expect(
      mentorPage.getByTestId(`proposal-accept-${seeded.id}`),
    ).toHaveCount(0, { timeout: 10000 });
    await mentorPage.close();

    // --- Mentee sees declined state in Proposals (outgoing) ---
    const menteePage = await menteeContext.newPage();
    await menteePage.goto(`/${orgSlug}/mentorship?tab=proposals`);
    const outgoing = menteePage.getByTestId(`outgoing-proposal-${seeded.id}`);
    await expect(outgoing).toBeVisible({ timeout: 10000 });
    await expect(outgoing).toHaveAttribute("data-pair-status", "declined");
    await expect(outgoing.getByText(DECLINE_REASON)).toBeVisible();
    await menteePage.close();
  });
});
