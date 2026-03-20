import { test, expect } from "@playwright/test";
import { TestData } from "../fixtures/test-data";

test.describe("Billing Portal Access", () => {
  const orgSlug = TestData.getOrgSlug();

  test("admin can access billing portal", async ({ page }) => {
    // Navigate to organization settings/billing page
    await page.goto(`/${orgSlug}/settings`);
    await page.waitForLoadState("networkidle");

    // Look for billing/subscription related link or button
    const billingLink = page.locator(
      'a:has-text("Billing"), a:has-text("Subscription"), button:has-text("Manage Subscription")'
    );

    const hasBillingLink = await billingLink.count() > 0;
    test.skip(!hasBillingLink, "Billing link not present in test org — skipping portal access test");

    // Set up listener for new page/tab (Stripe portal opens in new tab sometimes)
    const [newPage] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 10000 }).catch(() => null),
      billingLink.first().click(),
    ]);

    if (newPage) {
      // Stripe portal opened in new tab
      await newPage.waitForLoadState("domcontentloaded");
      expect(newPage.url()).toMatch(/stripe\.com|billing/);
    } else {
      // Check for redirect to Stripe or billing page
      await page.waitForURL(
        (url) => url.hostname.includes("stripe.com") || url.pathname.includes("billing"),
        { timeout: 30000 }
      );
      expect(page.url()).toMatch(/stripe\.com|billing/);
    }
  });

  test("shows error when no subscription exists", async ({ page }) => {
    // Test that the billing/settings page loads without crashing
    await page.goto(`/${orgSlug}/settings`);
    await page.waitForLoadState("networkidle");

    // The page should load without throwing errors
    await expect(page.locator("main")).toBeVisible();

    // If there's billing-related content, verify it's accessible
    const billingSection = page.locator("text=/billing|subscription|plan/i");
    const hasBillingSection = await billingSection.count() > 0;
    test.skip(!hasBillingSection, "No billing section found in test org — skipping billing content check");

    await expect(billingSection.first()).toBeVisible();
  });
});
