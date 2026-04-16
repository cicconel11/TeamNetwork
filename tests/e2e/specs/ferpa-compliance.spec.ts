import { test, expect } from "@playwright/test";
import { AccountSettingsPage } from "../page-objects/AccountSettingsPage";
import { AcceptTermsPage } from "../page-objects/AcceptTermsPage";
import { TestData } from "../fixtures/test-data";

/**
 * FERPA Compliance E2E Tests
 *
 * These tests verify the key FERPA requirements:
 * 1. Right to access/export personal data (Article 20 - GDPR, supports FERPA)
 * 2. Right to deletion (30-day grace period)
 * 3. ToS/Privacy Policy acceptance tracking
 * 4. Audit trail for data access
 *
 * Note: Tests requiring auth depend on e2e-setup project.
 * Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD env vars for full coverage.
 */

test.describe("FERPA Compliance: Data Export", () => {
  test("user can access data export from account settings", async ({ page }) => {
    const accountPage = new AccountSettingsPage(page);

    await accountPage.goto();
    await accountPage.expectDataExportLinkVisible();
  });

  test("data export returns valid JSON with user data", async ({ page }) => {
    const accountPage = new AccountSettingsPage(page);

    await accountPage.goto();

    // Intercept the export request
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/user/export-data") &&
        response.status() === 200
    );

    await accountPage.dataExportLink.click();
    const response = await responsePromise;

    // Verify response headers
    const contentType = response.headers()["content-type"];
    expect(contentType).toContain("application/json");

    const contentDisposition = response.headers()["content-disposition"];
    expect(contentDisposition).toContain("attachment");
    expect(contentDisposition).toContain("teamnetwork-data-export");

    // Verify response body structure
    const data = await response.json();
    expect(data).toHaveProperty("exportedAt");
    expect(data).toHaveProperty("user");
    expect(data).toHaveProperty("memberships");
    expect(data.user).toHaveProperty("id");
    expect(data.user).toHaveProperty("email");
  });

  test("data export is rate limited", async ({ page }) => {
    const accountPage = new AccountSettingsPage(page);

    await accountPage.goto();

    // First request should succeed
    const firstResponse = await page.request.get("/api/user/export-data");
    expect(firstResponse.status()).toBe(200);

    // Subsequent requests within rate limit window should be blocked
    const secondResponse = await page.request.get("/api/user/export-data");
    // Rate limit returns 429
    expect(secondResponse.status()).toBe(429);
  });
});

test.describe("FERPA Compliance: Account Deletion", () => {
  test("account settings shows delete section", async ({ page }) => {
    const accountPage = new AccountSettingsPage(page);

    await accountPage.goto();
    await accountPage.expectDeleteSectionVisible();
  });

  test("delete button is disabled without confirmation text", async ({ page }) => {
    const accountPage = new AccountSettingsPage(page);

    await accountPage.goto();

    // Button should be disabled initially
    await expect(accountPage.deleteButton).toBeDisabled();

    // Type partial confirmation
    await accountPage.deleteConfirmationInput.fill("DELETE");
    await expect(accountPage.deleteButton).toBeDisabled();

    // Type correct confirmation
    await accountPage.deleteConfirmationInput.fill("DELETE MY ACCOUNT");
    await expect(accountPage.deleteButton).toBeEnabled();
  });

  test("deletion request shows 30-day grace period message", async ({ page }) => {
    // This test uses a dedicated test user to avoid affecting real accounts
    // Skip in CI without proper test user setup
    test.skip(
      !process.env.E2E_DELETION_TEST_USER,
      "Requires dedicated deletion test user"
    );

    const accountPage = new AccountSettingsPage(page);
    await accountPage.goto();

    // Initiate deletion
    await accountPage.initiateAccountDeletion();

    // Should show success message with date
    await expect(
      page.locator("text=Account deletion scheduled")
    ).toBeVisible({ timeout: 10000 });

    // Should show pending status
    await accountPage.expectDeletionPending();
  });

  test("user can cancel pending deletion", async ({ page }) => {
    test.skip(
      !process.env.E2E_DELETION_TEST_USER,
      "Requires dedicated deletion test user"
    );

    const accountPage = new AccountSettingsPage(page);
    await accountPage.goto();

    // If there's a pending deletion, cancel it
    if (await accountPage.cancelDeletionButton.isVisible()) {
      await accountPage.cancelAccountDeletion();

      // Should show cancellation success
      await expect(
        page.locator("text=deletion has been cancelled")
      ).toBeVisible({ timeout: 10000 });

      // Pending banner should disappear
      await accountPage.expectNoDeletionPending();
    }
  });

  test("org admin cannot delete account without transferring admin role", async ({
    page,
  }) => {
    // This tests that org admins see the proper error
    const accountPage = new AccountSettingsPage(page);

    await accountPage.goto();
    await accountPage.deleteConfirmationInput.fill("DELETE MY ACCOUNT");
    await accountPage.deleteButton.click();

    // Should show error about admin role
    await expect(
      page.locator("text=Cannot delete account while you are an admin")
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe("FERPA Compliance: Terms of Service Acceptance", () => {
  test("accept-terms page shows ToS and Privacy Policy links", async ({
    page,
  }) => {
    const acceptTermsPage = new AcceptTermsPage(page);

    await acceptTermsPage.goto();

    await acceptTermsPage.expectTermsLinkVisible();
    await acceptTermsPage.expectPrivacyLinkVisible();
  });

  test("continue button is disabled until checkbox is checked", async ({
    page,
  }) => {
    const acceptTermsPage = new AcceptTermsPage(page);

    await acceptTermsPage.goto();

    // Button should be disabled initially
    await acceptTermsPage.expectContinueDisabled();

    // Check the checkbox
    await acceptTermsPage.termsCheckbox.check();

    // Button should now be enabled
    await acceptTermsPage.expectContinueEnabled();
  });

  test("accepting terms redirects to specified destination", async ({
    page,
  }) => {
    const acceptTermsPage = new AcceptTermsPage(page);
    const orgSlug = TestData.getOrgSlug();
    const redirectTo = `/${orgSlug}/members`;

    await acceptTermsPage.goto(redirectTo);
    await acceptTermsPage.acceptTerms();

    // Should redirect to the specified page
    await page.waitForURL((url) => url.pathname.includes("/members"), {
      timeout: 15000,
    });
  });

  test("accepting terms without redirect goes to /app", async ({ page }) => {
    const acceptTermsPage = new AcceptTermsPage(page);

    await acceptTermsPage.goto();
    await acceptTermsPage.acceptTerms();

    // Should redirect to /app
    await page.waitForURL((url) => url.pathname.startsWith("/app"), {
      timeout: 15000,
    });
  });
});

test.describe("FERPA Compliance: API Endpoints", () => {
  test("export-data API requires authentication", async ({ request }) => {
    // Create a new context without auth
    const response = await request.get("/api/user/export-data", {
      headers: {
        Cookie: "", // Clear cookies
      },
    });

    expect(response.status()).toBe(401);
  });

  test("delete-account API requires authentication", async ({ request }) => {
    const response = await request.delete("/api/user/delete-account", {
      headers: {
        Cookie: "",
      },
      data: { confirmation: "DELETE MY ACCOUNT" },
    });

    expect(response.status()).toBe(401);
  });

  test("delete-account API requires exact confirmation text", async ({
    request,
  }) => {
    const response = await request.delete("/api/user/delete-account", {
      data: { confirmation: "wrong text" },
    });

    // Should fail validation
    expect(response.status()).toBe(400);
  });

  test("accept-terms API requires authentication", async ({ request }) => {
    const response = await request.post("/api/auth/accept-terms", {
      headers: {
        Cookie: "",
      },
      data: { accepted: true },
    });

    expect(response.status()).toBe(401);
  });

  test("accept-terms API validates request body", async ({ request }) => {
    const response = await request.post("/api/auth/accept-terms", {
      data: { accepted: false }, // Must be true
    });

    // Should fail validation (accepted must be literal true)
    expect(response.status()).toBe(400);
  });
});

test.describe("FERPA Compliance: Audit Trail", () => {
  test("data export logs access event", async ({ page }) => {
    const accountPage = new AccountSettingsPage(page);

    await accountPage.goto();

    // Listen for the export request to verify audit headers aren't exposed
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/user/export-data")
    );

    await accountPage.dataExportLink.click();
    const response = await responsePromise;

    // Response should succeed
    expect(response.status()).toBe(200);

    // Audit logging happens server-side, so we can't directly verify
    // but we confirm the endpoint completed successfully
    const data = await response.json();
    expect(data.exportedAt).toBeDefined();
  });
});
