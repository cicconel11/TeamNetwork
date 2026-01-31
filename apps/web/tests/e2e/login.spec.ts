import { test, expect } from "@playwright/test";

test.describe("Login Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth/login");
  });

  test("displays login form with all required elements", async ({ page }) => {
    // Verify page title and branding
    await expect(page.getByRole("heading", { name: /TeamNetwork/i })).toBeVisible();
    await expect(page.getByText("Sign in to your account")).toBeVisible();

    // Verify Google OAuth button
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();

    // Verify email input
    const emailInput = page.getByLabel("Email");
    await expect(emailInput).toBeVisible();

    // Verify password input (visible in password mode by default)
    const passwordInput = page.getByLabel("Password");
    await expect(passwordInput).toBeVisible();

    // Verify submit button
    await expect(page.getByRole("button", { name: /Sign In/i })).toBeVisible();

    // Verify sign up link
    await expect(page.getByRole("link", { name: /Sign up/i })).toBeVisible();

    // Verify mode toggle buttons
    await expect(page.getByRole("button", { name: "Password" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Magic Link" })).toBeVisible();
  });

  test("can switch between password and magic link modes", async ({ page }) => {
    // Start in password mode - password field should be visible
    const passwordInput = page.getByLabel("Password");
    await expect(passwordInput).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign In/i })).toBeVisible();

    // Switch to magic link mode
    await page.getByRole("button", { name: "Magic Link" }).click();

    // Password field should be hidden, button text should change
    await expect(passwordInput).not.toBeVisible();
    await expect(page.getByRole("button", { name: /Send Magic Link/i })).toBeVisible();

    // Switch back to password mode
    await page.getByRole("button", { name: "Password" }).click();
    await expect(passwordInput).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign In/i })).toBeVisible();
  });

  test("shows captcha error when submitting without captcha verification", async ({ page }) => {
    // Fill in the form
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password").fill("testpassword123");

    // Submit button should be disabled without captcha
    const submitButton = page.getByRole("button", { name: /Sign In/i });
    await expect(submitButton).toBeDisabled();
  });

  test("forgot password link navigates to correct page", async ({ page }) => {
    const forgotPasswordLink = page.getByRole("link", { name: /Forgot password/i });
    await expect(forgotPasswordLink).toBeVisible();
    await expect(forgotPasswordLink).toHaveAttribute("href", "/auth/forgot-password");
  });

  test("sign up link navigates to correct page", async ({ page }) => {
    const signUpLink = page.getByRole("link", { name: /Sign up/i });
    await expect(signUpLink).toBeVisible();
    await expect(signUpLink).toHaveAttribute("href", "/auth/signup");
  });

  test("email input validates email format", async ({ page }) => {
    const emailInput = page.getByLabel("Email");

    // Fill with invalid email and blur
    await emailInput.fill("invalid-email");
    await emailInput.blur();

    // The HTML5 email validation should mark the input as invalid
    const isInvalid = await emailInput.evaluate(
      (el: HTMLInputElement) => !el.checkValidity()
    );
    expect(isInvalid).toBe(true);

    // Fill with valid email
    await emailInput.fill("valid@example.com");
    const isValid = await emailInput.evaluate(
      (el: HTMLInputElement) => el.checkValidity()
    );
    expect(isValid).toBe(true);
  });

  test("password input is of type password", async ({ page }) => {
    const passwordInput = page.getByLabel("Password");
    await expect(passwordInput).toHaveAttribute("type", "password");
  });

  test("preserves redirect query parameter", async ({ page }) => {
    // Navigate with a redirect parameter
    await page.goto("/auth/login?redirect=/org-slug/members");

    // The page should load with the redirect parameter
    expect(page.url()).toContain("redirect=/org-slug/members");
  });

  test("has accessible form structure", async ({ page }) => {
    // All inputs should have associated labels
    const emailInput = page.getByLabel("Email");
    const passwordInput = page.getByLabel("Password");

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();

    // Inputs should have required attribute
    await expect(emailInput).toHaveAttribute("required", "");
    await expect(passwordInput).toHaveAttribute("required", "");

    // Form should be keyboard navigable
    await emailInput.focus();
    expect(await emailInput.evaluate((el) => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    expect(await passwordInput.evaluate((el) => document.activeElement === el)).toBe(true);
  });
});
