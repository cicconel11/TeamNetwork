import { Page, Locator } from "@playwright/test";

/**
 * Base page object with common helpers for all pages.
 */
export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Get element by data-testid attribute
   */
  getByTestId(testId: string): Locator {
    return this.page.locator(`[data-testid="${testId}"]`);
  }

  /**
   * Wait for navigation to complete
   */
  async waitForNavigation(): Promise<void> {
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Wait for an element to be visible
   */
  async waitForVisible(testId: string): Promise<void> {
    await this.getByTestId(testId).waitFor({ state: "visible" });
  }

  /**
   * Check if an element exists on the page
   */
  async elementExists(testId: string): Promise<boolean> {
    return (await this.getByTestId(testId).count()) > 0;
  }

  /**
   * Get the current URL path
   */
  getCurrentPath(): string {
    return new URL(this.page.url()).pathname;
  }
}
