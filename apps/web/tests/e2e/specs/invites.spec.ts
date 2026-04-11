import { test, expect } from "@playwright/test";
import { TestData } from "../fixtures/test-data";

test.describe("Invite management", () => {
  const orgSlug = TestData.getOrgSlug();

  test("create invite code, verify visible, revoke", async ({ page }) => {
    await page.goto(`/${orgSlug}/settings/invites`);
    await page.waitForLoadState("networkidle");

    const initialRowCount = await page.getByTestId("invite-row").count();
    await page.getByTestId("invite-open-form").click();
    await expect(page.getByTestId("invite-submit")).toBeVisible();

    await page.getByTestId("invite-submit").click();

    await expect(page.getByTestId("invite-row")).toHaveCount(initialRowCount + 1, {
      timeout: 10000,
    });

    const newestRow = page.getByTestId("invite-row").first();
    await expect(newestRow.getByTestId("invite-revoke")).toBeVisible();

    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    await newestRow.getByTestId("invite-revoke").click();

    await expect(async () => {
      await expect(newestRow.getByText("Revoked")).toBeVisible();
      await expect(newestRow.getByTestId("invite-revoke")).toHaveCount(0);
    }).toPass({ timeout: 10000 });
  });
});
