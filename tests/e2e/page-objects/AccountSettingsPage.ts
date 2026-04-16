import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * Page object for the Account Settings page (/settings/account).
 * Handles FERPA compliance features: data export, account deletion.
 */
export class AccountSettingsPage extends BasePage {
  readonly dataExportLink: Locator;
  readonly deleteAccountSection: Locator;
  readonly deleteConfirmationInput: Locator;
  readonly deleteButton: Locator;
  readonly cancelDeletionButton: Locator;
  readonly deletionPendingBanner: Locator;

  constructor(page: Page) {
    super(page);
    this.dataExportLink = page.locator('a[href="/api/user/export-data"]');
    this.deleteAccountSection = page.locator('[class*="border-red"]');
    this.deleteConfirmationInput = page.locator('input#delete-confirmation');
    this.deleteButton = page.locator('button:has-text("Delete My Account")');
    this.cancelDeletionButton = page.locator('button:has-text("Cancel Deletion")');
    this.deletionPendingBanner = page.locator('text=Deletion Pending');
  }

  async goto(): Promise<void> {
    await this.page.goto("/settings/account");
    await this.page.waitForLoadState("networkidle");
  }

  async clickDataExport(): Promise<void> {
    // Data export is a direct download link, so we intercept the response
    const downloadPromise = this.page.waitForResponse(
      (response) => response.url().includes("/api/user/export-data")
    );
    await this.dataExportLink.click();
    await downloadPromise;
  }

  async initiateAccountDeletion(): Promise<void> {
    await this.deleteConfirmationInput.fill("DELETE MY ACCOUNT");
    await this.deleteButton.click();
  }

  async cancelAccountDeletion(): Promise<void> {
    await this.cancelDeletionButton.click();
  }

  async expectDeletionPending(): Promise<void> {
    await expect(this.deletionPendingBanner).toBeVisible();
  }

  async expectNoDeletionPending(): Promise<void> {
    await expect(this.deletionPendingBanner).not.toBeVisible();
  }

  async expectDataExportLinkVisible(): Promise<void> {
    await expect(this.dataExportLink).toBeVisible();
  }

  async expectDeleteSectionVisible(): Promise<void> {
    await expect(this.deleteAccountSection).toBeVisible();
  }
}
