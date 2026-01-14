import { test as setup, expect } from "@playwright/test";
import { TestData } from "./fixtures/test-data";
import { LoginPage } from "./page-objects/LoginPage";

const authFile = "playwright/.auth/e2e-state.json";

/**
 * Setup test that authenticates as the E2E admin user
 * and saves the session state for use by other tests.
 */
setup("authenticate as E2E admin", async ({ page }) => {
  const credentials = TestData.getAdminCredentials();
  const loginPage = new LoginPage(page);

  // Navigate to login
  await loginPage.goto();

  // Fill in credentials and submit
  await loginPage.login(credentials.email, credentials.password);

  // Wait for redirect to /app or org page (successful login)
  await page.waitForURL((url) => {
    const path = url.pathname;
    return path.startsWith("/app") || path.includes(TestData.getOrgSlug());
  }, { timeout: 30000 });

  // Verify we're logged in by checking we're not on login page
  expect(page.url()).not.toContain("/auth/login");

  // Save the authenticated state
  await page.context().storageState({ path: authFile });
});
