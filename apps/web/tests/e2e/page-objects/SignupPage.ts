import { Page, expect } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * Page object for the signup page (/auth/signup)
 */
export class SignupPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to the signup page
   */
  async goto(): Promise<void> {
    await this.page.goto("/auth/signup");
    await this.waitForNavigation();
  }

  /**
   * Fill in the name field
   */
  async fillName(name: string): Promise<void> {
    await this.getByTestId("signup-name").fill(name);
  }

  /**
   * Fill in the email field
   */
  async fillEmail(email: string): Promise<void> {
    await this.getByTestId("signup-email").fill(email);
  }

  /**
   * Fill in the password field
   */
  async fillPassword(password: string): Promise<void> {
    await this.getByTestId("signup-password").fill(password);
  }

  /**
   * Click the submit button
   */
  async submit(): Promise<void> {
    await this.getByTestId("signup-submit").click();
  }

  /**
   * Click Google signup button
   */
  async clickGoogleSignup(): Promise<void> {
    await this.getByTestId("signup-google").click();
  }

  /**
   * Perform a complete signup
   */
  async signup(name: string, email: string, password: string): Promise<void> {
    await this.fillName(name);
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.submit();
  }

  /**
   * Get the error message element
   */
  get errorMessage() {
    return this.getByTestId("signup-error");
  }

  /**
   * Get the success message element
   */
  get successMessage() {
    return this.getByTestId("signup-success");
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
