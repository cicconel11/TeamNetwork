import { Page, expect } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * Page object for the forgot password page (/auth/forgot-password)
 */
export class ForgotPasswordPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to the forgot password page
   */
  async goto(): Promise<void> {
    await this.page.goto("/auth/forgot-password");
    await this.waitForNavigation();
  }

  /**
   * Fill in the email field
   */
  async fillEmail(email: string): Promise<void> {
    await this.getByTestId("forgot-password-email").fill(email);
  }

  /**
   * Click the submit button
   */
  async submit(): Promise<void> {
    await this.getByTestId("forgot-password-submit").click();
  }

  /**
   * Request password reset for an email
   */
  async requestReset(email: string): Promise<void> {
    await this.fillEmail(email);
    await this.submit();
  }

  /**
   * Get the error message element
   */
  get errorMessage() {
    return this.getByTestId("forgot-password-error");
  }

  /**
   * Get the success message element
   */
  get successMessage() {
    return this.getByTestId("forgot-password-success");
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
