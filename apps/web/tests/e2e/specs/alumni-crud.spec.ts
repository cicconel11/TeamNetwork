import { test, expect } from "@playwright/test";
import { TestData } from "../fixtures/test-data";

test.describe("Alumni CRUD", () => {
  const orgSlug = TestData.getOrgSlug();

  test("full lifecycle: create, verify, edit, delete", async ({ page }) => {
    const alumni = TestData.generateAlumni();

    // CREATE
    await page.goto(`/${orgSlug}/alumni`);
    await page.getByTestId("alumni-new-link").click();
    await page.waitForURL(/\/alumni\/new/);
    await page.getByTestId("alumni-first-name").fill(alumni.firstName);
    await page.getByTestId("alumni-last-name").fill(alumni.lastName);
    await page.getByTestId("alumni-email").fill(alumni.email);
    await page.getByTestId("alumni-graduation-year").fill(alumni.graduationYear);
    await page.getByTestId("alumni-submit").click();

    // VERIFY in list
    await page.waitForURL(
      (url) => url.pathname.includes("/alumni") && !url.pathname.includes("/new"),
      { timeout: 30000 }
    );
    await page.goto(`/${orgSlug}/alumni`);
    await expect(page.getByText(alumni.firstName)).toBeVisible();

    // EDIT — navigate to detail, then edit
    await page.getByText(alumni.firstName).click();
    await page.waitForURL(/\/alumni\/[^/]+$/, { timeout: 30000 });
    await page.getByTestId("alumni-edit-link").click();
    await page.waitForURL(/\/edit/, { timeout: 30000 });

    const updatedLastName = `${alumni.lastName}-edited`;
    await page.getByTestId("alumni-last-name").fill(updatedLastName);
    await page.getByTestId("alumni-edit-submit").click();

    // Verify edit
    await page.waitForURL(/\/alumni\/[^/]+$/, { timeout: 30000 });
    await expect(page.getByText(updatedLastName)).toBeVisible();

    // DELETE — from detail page
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.getByTestId("alumni-delete-button").click();

    // Verify removed from list
    await page.waitForURL(
      (url) => url.pathname === `/${orgSlug}/alumni`,
      { timeout: 30000 }
    );
    await expect(page.getByText(alumni.firstName)).not.toBeVisible();
  });
});
