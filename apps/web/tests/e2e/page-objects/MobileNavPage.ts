import { expect, Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";
import { TestData } from "../fixtures/test-data";

/**
 * Page object for the mobile drawer navigation (MobileNav + OrgSidebar).
 * Use with the `e2e-mobile` Playwright project (iPhone 13 viewport).
 */
export class MobileNavPage extends BasePage {
  readonly header: Locator;
  readonly toggle: Locator;
  readonly backdrop: Locator;
  readonly drawer: Locator;

  constructor(page: Page) {
    super(page);
    this.header = this.getByTestId("mobile-nav");
    this.toggle = this.getByTestId("mobile-nav-toggle");
    this.backdrop = this.getByTestId("mobile-nav-backdrop");
    this.drawer = this.getByTestId("mobile-nav-drawer");
  }

  async gotoOrgHome(): Promise<void> {
    await this.page.goto(`/${TestData.getOrgSlug()}`);
    await this.header.waitFor({ state: "visible" });
    await this.dismissAiPanelIfPresent();
  }

  async gotoOrgPath(subPath: string): Promise<void> {
    const slug = TestData.getOrgSlug();
    const cleaned = subPath.startsWith("/") ? subPath : `/${subPath}`;
    await this.page.goto(`/${slug}${cleaned}`);
    await this.header.waitFor({ state: "visible" });
    await this.dismissAiPanelIfPresent();
  }

  /**
   * The org home auto-mounts a fixed-position AI assistant panel that
   * intercepts pointer events on the hamburger button. Close it if present
   * before interacting with the mobile nav.
   */
  private async dismissAiPanelIfPresent(): Promise<void> {
    const panel = this.page.locator(".ai-panel-enter");
    if ((await panel.count()) === 0) return;
    const closeBtn = panel.locator('button[aria-label="Close"]').first();
    if ((await closeBtn.count()) > 0) {
      await closeBtn.click({ trial: false }).catch(() => {});
      await panel.waitFor({ state: "hidden" }).catch(() => {});
    }
  }

  async openMenu(): Promise<void> {
    if (await this.isMenuOpen()) return;
    await this.toggle.click();
    await expect(this.drawer).toHaveAttribute("data-state", "open");
  }

  async closeMenuViaToggle(): Promise<void> {
    if (!(await this.isMenuOpen())) return;
    await this.toggle.click();
    await expect(this.drawer).toHaveAttribute("data-state", "closed");
  }

  async pressEscape(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  async clickBackdrop(): Promise<void> {
    await this.backdrop.click();
  }

  async isMenuOpen(): Promise<boolean> {
    return (await this.drawer.getAttribute("data-state")) === "open";
  }

  navItem(slug: string): Locator {
    return this.drawer.locator(`[data-testid="nav-item-${slug}"]`);
  }

  groupToggle(groupId: string): Locator {
    return this.drawer.locator(`[data-testid="nav-group-toggle-${groupId}"]`);
  }

  group(groupId: string): Locator {
    return this.drawer.locator(`[data-testid="nav-group-${groupId}"]`);
  }

  async clickNavItem(slug: string): Promise<void> {
    await this.navItem(slug).click();
  }

  async toggleGroup(groupId: string): Promise<void> {
    await this.groupToggle(groupId).click();
  }

  async groupExpanded(groupId: string): Promise<boolean> {
    const expanded = await this.groupToggle(groupId).getAttribute("aria-expanded");
    return expanded === "true";
  }
}
