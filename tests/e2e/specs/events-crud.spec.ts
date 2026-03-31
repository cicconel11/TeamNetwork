import { test, expect } from "@playwright/test";
import { TestData } from "../fixtures/test-data";

test.describe("Event management", () => {
  const orgSlug = TestData.getOrgSlug();

  test("full lifecycle: create, verify, edit, delete", async ({ page }) => {
    const event = TestData.generateEvent();

    await page.goto(`/${orgSlug}/events`);
    await page.waitForURL((url) => url.pathname === `/${orgSlug}/calendar`, { timeout: 30000 });

    // CREATE
    await page.goto(`/${orgSlug}/calendar`);
    await page.getByTestId("event-new-link").click();
    await page.waitForURL(/\/calendar\/events\/new/);
    await page.getByTestId("event-title").fill(event.title);
    await page.getByTestId("event-start-date").fill(event.startDate);
    await page.getByTestId("event-location").fill(event.location);
    await page.getByTestId("event-submit").click();

    // VERIFY in list
    await page.waitForURL(
      (url) => url.pathname === `/${orgSlug}/calendar`,
      { timeout: 30000 }
    );
    await page.goto(`/${orgSlug}/calendar`);
    await expect(page.getByText(event.title)).toBeVisible();

    // EDIT
    await page.getByText(event.title).click();
    await page.waitForURL(/\/calendar\/events\/[^/]+$/, { timeout: 30000 });
    await page.getByTestId("event-edit-link").click();
    await page.waitForURL(/\/edit/, { timeout: 30000 });

    const updatedTitle = `${event.title} Updated`;
    await page.getByTestId("event-title").fill(updatedTitle);
    await page.getByTestId("event-edit-submit").click();

    await page.waitForURL(/\/calendar\/events\/[^/]+$/, { timeout: 30000 });
    await expect(page.getByText(updatedTitle)).toBeVisible();

    // DELETE
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.getByTestId("event-delete-button").click();

    await page.waitForURL(
      (url) => url.pathname === `/${orgSlug}/calendar`,
      { timeout: 30000 }
    );
    await expect(page.getByText(updatedTitle)).not.toBeVisible();
  });
});
