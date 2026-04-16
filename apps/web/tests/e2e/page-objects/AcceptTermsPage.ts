import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * Page object for the Accept Terms page (/auth/accept-terms).
 * FERPA/COPPA compliance: ToS acceptance before access.
 */
export class AcceptTermsPage extends BasePage {
  readonly termsCheckbox: Locator;
  readonly continueButton: Locator;
  readonly tosLink: Locator;
  readonly privacyLink: Locator;

  constructor(page: Page) {
    super(page);
    this.termsCheckbox = page.getByTestId("accept-terms-checkbox");
    this.continueButton = page.getByTestId("accept-terms-submit");
    this.tosLink = page.locator('a[href="/terms"]');
    this.privacyLink = page.locator('a[href="/privacy"]');
  }

  async goto(redirectTo?: string): Promise<void> {
    const url = redirectTo
      ? `/auth/accept-terms?redirect=${encodeURIComponent(redirectTo)}`
      : "/auth/accept-terms";
    await this.page.goto(url);
    await this.page.waitForLoadState("networkidle");
  }

  async acceptTerms(): Promise<void> {
    await this.termsCheckbox.check();
    await this.continueButton.click();
  }

  async expectContinueDisabled(): Promise<void> {
    await expect(this.continueButton).toBeDisabled();
  }

  async expectContinueEnabled(): Promise<void> {
    await expect(this.continueButton).toBeEnabled();
  }

  async expectTermsLinkVisible(): Promise<void> {
    await expect(this.tosLink).toBeVisible();
  }

  async expectPrivacyLinkVisible(): Promise<void> {
    await expect(this.privacyLink).toBeVisible();
  }

  async isOnAcceptTermsPage(): Promise<boolean> {
    return this.page.url().includes("/auth/accept-terms");
  }
}
