import { test, expect, type BrowserContext } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TestData } from "../fixtures/test-data";
import {
  clearMentorshipRowsBetween,
  deleteChatGroupsBetween,
  getServiceClient,
  loginAsUser,
  mentorshipEnvMissing,
} from "../fixtures/mentorship-helpers";

/**
 * UI flow: mentee self-requests intro from Directory, then mentor accepts
 * from the Proposals tab. Verifies toast, pair appearance, chat link.
 *
 * Testids added: `mentor-card-<userId>`, `mentor-card-<userId>-request`,
 * `mentor-request-dialog`, `mentor-request-dialog-send`,
 * `incoming-proposal-<pairId>`, `proposal-accept-<pairId>`,
 * `mentorship-pair-chip-<pairId>`. The activity pair row / chat-link testids
 * still fall back to role+text — see TODO(testid) markers below.
 *
 * Relies on fixtures in tests/e2e/fixtures/mentorship-helpers.ts — ensure the
 * env vars listed there (E2E_MENTOR_*, E2E_MENTEE_*, E2E_ORG_ID) are set and
 * seeded per the preconditions documented in mentorship-phase2.spec.ts.
 */

const missing = mentorshipEnvMissing();
const orgSlug = TestData.getOrgSlug();

test.describe("Mentorship: request -> accept (UI)", () => {
  test.skip(missing.length > 0, `Missing env: ${missing.join(", ")}`);
  test.describe.configure({ mode: "serial" });

  const orgId = TestData.getOrgId();
  const mentor = TestData.getMentorCredentials();
  const mentee = TestData.getMenteeCredentials();

  let supabase: SupabaseClient;
  let menteeContext: BrowserContext;
  let mentorContext: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    supabase = getServiceClient();
    menteeContext = (await loginAsUser(browser, mentee.email, mentee.password)).context;
    mentorContext = (await loginAsUser(browser, mentor.email, mentor.password)).context;
  });

  test.afterAll(async () => {
    await menteeContext?.close();
    await mentorContext?.close();
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

  test("mentee requests intro and mentor accepts from Proposals", async () => {
    // --- Mentee: request intro via Directory ---
    const menteePage = await menteeContext.newPage();
    await menteePage.goto(`/${orgSlug}/mentorship?tab=directory`);

    const requestBtn = menteePage.getByTestId(`mentor-card-${mentor.userId}-request`);
    await expect(requestBtn).toBeVisible();
    await requestBtn.click();

    await expect(menteePage.getByTestId("mentor-request-dialog")).toBeVisible();
    const sendBtn = menteePage.getByTestId("mentor-request-dialog-send");
    await expect(sendBtn).toBeVisible();

    const requestResponsePromise = menteePage.waitForResponse(
      (r) =>
        r.url().includes(`/api/organizations/${orgId}/mentorship/requests`) &&
        r.request().method() === "POST",
    );
    await sendBtn.click();
    const requestResponse = await requestResponsePromise;
    expect([200, 201]).toContain(requestResponse.status());

    // Toast — sonner renders a region with text "Request sent".
    await expect(menteePage.getByText("Request sent")).toBeVisible({ timeout: 5000 });

    // Navigate to Activity tab and confirm the new proposed pair is listed.
    await menteePage.goto(`/${orgSlug}/mentorship?tab=activity`);
    // TODO(testid): data-testid="mentorship-activity-pair-<pairId>" with status.
    await expect(
      menteePage.getByText(/Proposed|Awaiting/i).first(),
    ).toBeVisible({ timeout: 10000 });
    await menteePage.close();

    // --- Mentor: accept from Proposals tab ---
    const mentorPage = await mentorContext.newPage();
    await mentorPage.goto(`/${orgSlug}/mentorship?tab=proposals`);

    const incomingRow = mentorPage.locator('[data-testid^="incoming-proposal-"]').first();
    await expect(incomingRow).toBeVisible();
    const acceptBtn = incomingRow.locator('[data-testid^="proposal-accept-"]');
    await expect(acceptBtn).toBeVisible();

    const patchResponsePromise = mentorPage.waitForResponse(
      (r) =>
        /\/api\/organizations\/[^/]+\/mentorship\/pairs\/[^/]+$/.test(r.url()) &&
        r.request().method() === "PATCH",
    );
    await acceptBtn.click();
    const patchResponse = await patchResponsePromise;
    expect(patchResponse.status()).toBe(200);

    await expect(mentorPage.getByText("Proposal accepted")).toBeVisible({ timeout: 5000 });

    // Activity tab should now show the pair + a chat link.
    await mentorPage.goto(`/${orgSlug}/mentorship?tab=activity`);
    // TODO(testid): data-testid="mentorship-activity-chat-link-<pairId>".
    await expect(
      mentorPage.getByRole("link", { name: /chat|message/i }).first(),
    ).toBeVisible({ timeout: 10000 });
    await mentorPage.close();
  });
});
