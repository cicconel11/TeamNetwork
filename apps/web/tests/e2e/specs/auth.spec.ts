import { test, expect } from "@playwright/test";
import { LoginPage } from "../page-objects/LoginPage";
import { SignupPage } from "../page-objects/SignupPage";
import { ForgotPasswordPage } from "../page-objects/ForgotPasswordPage";
import { TestData } from "../fixtures/test-data";

test.describe("Authentication Flows", () => {
  test.describe("Login", () => {
    test("successful login with email and password", async ({ page }) => {
      const loginPage = new LoginPage(page);
      const credentials = TestData.getAdminCredentials();

      await loginPage.goto();
      await loginPage.login(credentials.email, credentials.password);

      // Should redirect away from login page
      await page.waitForURL((url) => !url.pathname.includes("/auth/login"), {
        timeout: 30000,
      });
      expect(page.url()).not.toContain("/auth/login");
    });

    test("shows error with invalid credentials", async ({ page }) => {
      const loginPage = new LoginPage(page);

      await loginPage.goto();
      await loginPage.login("invalid@test.local", "wrongpassword");

      await loginPage.expectError();
    });

    test("sends magic link email", async ({ page }) => {
      const loginPage = new LoginPage(page);
      const credentials = TestData.getAdminCredentials();

      await loginPage.goto();
      await loginPage.switchToMagicLink();
      await loginPage.fillEmail(credentials.email);
      await loginPage.submit();

      // Should show success message about email sent
      await loginPage.expectSuccess("Check your email");
    });

    test("redirects to requested page after login", async ({ page }) => {
      const loginPage = new LoginPage(page);
      const credentials = TestData.getAdminCredentials();
      const orgSlug = TestData.getOrgSlug();
      const redirectPath = `/${orgSlug}/members`;

      await loginPage.goto(redirectPath);
      await loginPage.login(credentials.email, credentials.password);

      // Should redirect to the requested page
      await page.waitForURL((url) => url.pathname.includes("/members"), {
        timeout: 30000,
      });
      expect(page.url()).toContain("/members");
    });
  });

  test.describe("Signup", () => {
    test("successful signup shows confirmation message", async ({ page }) => {
      const signupPage = new SignupPage(page);
      const userData = TestData.generateUser();

      await signupPage.goto();
      await signupPage.signup(userData.name, userData.email, userData.password);

      // Should show confirmation message about email verification
      await signupPage.expectSuccess("Check your email");
    });

    test("shows error for weak password", async ({ page }) => {
      const signupPage = new SignupPage(page);
      const userData = TestData.generateUser();

      await signupPage.goto();
      await signupPage.fillName(userData.name);
      await signupPage.fillEmail(userData.email);
      await signupPage.fillPassword(TestData.weakPassword);
      await signupPage.submit();

      // The form should have validation or show an error
      // HTML5 validation should prevent submission with minLength=6
      const passwordInput = signupPage.getByTestId("signup-password");
      const validationMessage = await passwordInput.evaluate(
        (el: HTMLInputElement) => el.validationMessage
      );
      expect(validationMessage).not.toBe("");
    });
  });

  test.describe("Forgot Password", () => {
    test("sends password reset email", async ({ page }) => {
      const forgotPasswordPage = new ForgotPasswordPage(page);
      const credentials = TestData.getAdminCredentials();

      await forgotPasswordPage.goto();
      await forgotPasswordPage.requestReset(credentials.email);

      // Should show success message
      await forgotPasswordPage.expectSuccess("Check your email");
    });
  });

  test.describe("Logout", () => {
    test("successfully logs out user", async ({ page }) => {
      // First, login
      const loginPage = new LoginPage(page);
      const credentials = TestData.getAdminCredentials();

      await loginPage.goto();
      await loginPage.login(credentials.email, credentials.password);

      // Wait for successful login
      await page.waitForURL((url) => !url.pathname.includes("/auth/login"), {
        timeout: 30000,
      });

      // Navigate to settings or find logout button
      // The app structure may have logout in different places
      // Look for a logout link or button
      const logoutButton = page.locator('[href*="logout"], button:has-text("Logout"), button:has-text("Sign out")');

      if (await logoutButton.count() > 0) {
        await logoutButton.first().click();

        // Should be redirected to login or home
        await page.waitForURL((url) =>
          url.pathname === "/" || url.pathname.includes("/auth/login"),
          { timeout: 30000 }
        );
      } else {
        // If no visible logout button, try navigating to logout URL directly
        await page.goto("/auth/logout");
        await page.waitForURL((url) =>
          url.pathname === "/" || url.pathname.includes("/auth/login"),
          { timeout: 30000 }
        );
      }

      // Verify we're logged out by trying to access a protected page
      const orgSlug = TestData.getOrgSlug();
      await page.goto(`/${orgSlug}/members`);

      // Should be redirected to login
      await page.waitForURL((url) => url.pathname.includes("/auth/login"), {
        timeout: 30000,
      });
    });
  });
});
