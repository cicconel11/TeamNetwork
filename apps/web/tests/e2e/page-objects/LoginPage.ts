import { Page, expect } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * Page object for the login page (/auth/login)
 */
export class LoginPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to the login page
   */
  async goto(redirect?: string): Promise<void> {
    const url = redirect ? `/auth/login?redirect=${encodeURIComponent(redirect)}` : "/auth/login";
    await this.page.goto(url);
    await this.waitForNavigation();
  }

  /**
   * Fill in email field
   */
  async fillEmail(email: string): Promise<void> {
    await this.getByTestId("login-email").fill(email);
  }

  /**
   * Fill in password field
   */
  async fillPassword(password: string): Promise<void> {
    await this.getByTestId("login-password").fill(password);
  }

  /**
   * Click the submit button
   */
  async submit(): Promise<void> {
    await this.getByTestId("login-submit").click();
  }

  /**
   * Switch to magic link mode
   */
  async switchToMagicLink(): Promise<void> {
    await this.getByTestId("login-mode-magic").click();
  }

  /**
   * Switch to password mode
   */
  async switchToPassword(): Promise<void> {
    await this.getByTestId("login-mode-password").click();
  }

  /**
   * Click Google login button
   */
  async clickGoogleLogin(): Promise<void> {
    await this.getByTestId("login-google").click();
  }

  /**
   * Perform a complete login with email and password
   */
  async login(email: string, password: string): Promise<void> {
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.submit();
  }

  /**
   * Get the error message element
   */
  get errorMessage() {
    return this.getByTestId("login-error");
  }

  /**
   * Get the success message element
   */
  get successMessage() {
    return this.getByTestId("login-success");
  }

  /**
   * Assert that an error is displayed
   */
  async expectError(message?: string): Promise<void> {
    await expect(this.errorMessage).toBeVisible();
    if (message) {
      await expect(this.errorMessage).toContainText(message);
    }
  }

  /**
   * Assert that a success message is displayed
   */
  async expectSuccess(message?: string): Promise<void> {
    await expect(this.successMessage).toBeVisible();
    if (message) {
      await expect(this.successMessage).toContainText(message);
    }
  }
}
