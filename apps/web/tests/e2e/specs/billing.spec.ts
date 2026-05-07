import { test, expect } from "@playwright/test";
import { TestData } from "../fixtures/test-data";

test.describe("Billing Portal Access", () => {
  const orgSlug = TestData.getOrgSlug();

  test("admin can access billing portal", async ({ page }) => {
    await page.goto(`/${orgSlug}/settings`);
    await page.waitForLoadState("networkidle");

    const billingButton = page.getByRole("button", { name: "Manage Billing" });
    await expect(billingButton).toBeVisible();
    test.skip(await billingButton.isDisabled(), "Billing portal not configured for the test org");

    const [newPage] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 10000 }).catch(() => null),
      billingButton.click(),
    ]);

    if (newPage) {
      await newPage.waitForLoadState("domcontentloaded");
      expect(newPage.url()).toMatch(/stripe\.com|billing/);
    } else {
      await page.waitForURL(
        (url) => url.hostname.includes("stripe.com") || url.pathname.includes("billing"),
        { timeout: 30000 }
      );
      expect(page.url()).toMatch(/stripe\.com|billing/);
    }
  });

  test("renders billing management and subscription controls", async ({ page }) => {
    await page.goto(`/${orgSlug}/settings`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Billing Management" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Subscription & Alumni Quota" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage Billing" })).toBeVisible();
  });
});
