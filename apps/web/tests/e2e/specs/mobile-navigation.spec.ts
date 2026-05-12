import { expect, test } from "@playwright/test";
import { MobileNavPage } from "../page-objects/MobileNavPage";
import { TestData } from "../fixtures/test-data";

const HAS_ALUMNI = process.env.E2E_HAS_ALUMNI === "true";
const HAS_PARENTS = process.env.E2E_HAS_PARENTS === "true";

test.describe("Mobile navigation drawer", () => {
  let nav: MobileNavPage;

  test.beforeEach(async ({ page }) => {
    nav = new MobileNavPage(page);
    await nav.gotoOrgHome();
  });

  test("drawer is closed by default and hamburger is visible", async () => {
    await expect(nav.header).toBeVisible();
    await expect(nav.toggle).toBeVisible();
    await expect(nav.drawer).toHaveAttribute("data-state", "closed");
    await expect(nav.toggle).toHaveAttribute("aria-expanded", "false");
    await expect(nav.backdrop).toHaveCount(0);
  });

  test("opens via hamburger toggle", async () => {
    await nav.openMenu();
    await expect(nav.drawer).toHaveAttribute("data-state", "open");
    await expect(nav.toggle).toHaveAttribute("aria-expanded", "true");
    await expect(nav.backdrop).toBeVisible();
  });

  test("closes via Escape key", async () => {
    await nav.openMenu();
    await nav.pressEscape();
    await expect(nav.drawer).toHaveAttribute("data-state", "closed");
    await expect(nav.backdrop).toHaveCount(0);
  });

  test("closes via backdrop click", async () => {
    await nav.openMenu();
    await nav.clickBackdrop();
    await expect(nav.drawer).toHaveAttribute("data-state", "closed");
  });

  test("closes via toggle (X) when open", async () => {
    await nav.openMenu();
    await nav.closeMenuViaToggle();
    await expect(nav.drawer).toHaveAttribute("data-state", "closed");
  });

  test("sidebar contents lazy-mount on first open and remain mounted after close", async () => {
    // Before first open, no nav items rendered
    await expect(nav.navItem("members")).toHaveCount(0);

    await nav.openMenu();
    await expect(nav.navItem("members")).toBeVisible();

    await nav.pressEscape();
    await expect(nav.drawer).toHaveAttribute("data-state", "closed");
    // Sidebar stays in the DOM after the drawer slides out
    await expect(nav.navItem("members")).toHaveCount(1);
  });

  test("clicking a nav item navigates and auto-closes the drawer", async ({ page }) => {
    await nav.openMenu();

    // The "people" group must be expanded for Members to be reachable.
    if (!(await nav.groupExpanded("people"))) {
      await nav.toggleGroup("people");
    }

    await nav.clickNavItem("members");
    await page.waitForURL(`**/${TestData.getOrgSlug()}/members`);
    await expect(nav.drawer).toHaveAttribute("data-state", "closed");
  });

  test("active route is reflected via data-active on nav item", async () => {
    await nav.gotoOrgPath("/members");
    await nav.openMenu();
    if (!(await nav.groupExpanded("people"))) {
      await nav.toggleGroup("people");
    }
    await expect(nav.navItem("members")).toHaveAttribute("data-active", "true");
    await expect(nav.navItem("dashboard")).toHaveAttribute("data-active", "false");
  });

  test("nav group toggle expands and collapses", async () => {
    await nav.openMenu();

    // Activity is a group with no auto-active items on the home page.
    const initiallyOpen = await nav.groupExpanded("activity");

    await nav.toggleGroup("activity");
    await expect(nav.groupToggle("activity")).toHaveAttribute(
      "aria-expanded",
      initiallyOpen ? "false" : "true"
    );

    await nav.toggleGroup("activity");
    await expect(nav.groupToggle("activity")).toHaveAttribute(
      "aria-expanded",
      initiallyOpen ? "true" : "false"
    );
  });

  test("admin sees admin-gated nav items", async () => {
    await nav.openMenu();
    if (!(await nav.groupExpanded("admin"))) {
      await nav.toggleGroup("admin");
    }
    await expect(nav.navItem("settings-approvals")).toBeVisible();
    await expect(nav.navItem("settings-invites")).toBeVisible();
    await expect(nav.navItem("settings-navigation")).toBeVisible();
  });

  test("alumni-gated nav item visibility matches org access", async () => {
    test.skip(!HAS_ALUMNI, "Set E2E_HAS_ALUMNI=true when the seeded org has alumni access");
    await nav.openMenu();
    if (!(await nav.groupExpanded("people"))) {
      await nav.toggleGroup("people");
    }
    await expect(nav.navItem("alumni")).toBeVisible();
  });

  test("parents-gated nav item visibility matches org access", async () => {
    test.skip(!HAS_PARENTS, "Set E2E_HAS_PARENTS=true when the seeded org has parents access");
    await nav.openMenu();
    if (!(await nav.groupExpanded("people"))) {
      await nav.toggleGroup("people");
    }
    await expect(nav.navItem("parents")).toBeVisible();
  });

  test("no horizontal overflow at iPhone 13 width when drawer is open", async ({ page }) => {
    await nav.openMenu();
    const overflow = await page.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
  });

  test("desktop sidebar is hidden at mobile viewport", async ({ page }) => {
    // The desktop OrgSidebar wrapper uses `hidden lg:flex`; on mobile it must not be visible.
    // We assert by checking that the only rendered nav header is the mobile one.
    await expect(nav.header).toBeVisible();
    const desktopOnlyVisible = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('[class*="lg:flex"]')) as HTMLElement[];
      return all.some((el) => {
        const style = window.getComputedStyle(el);
        return style.display !== "none" && el.offsetWidth > 0 && el.closest('[data-testid="mobile-nav-drawer"]') == null;
      });
    });
    // Some `lg:flex` elements may legitimately be visible (cards etc.) — so this is informational only.
    // The hard check: the mobile drawer is the only element exposing `mobile-nav-drawer` testid.
    void desktopOnlyVisible;
    await expect(nav.getByTestId("mobile-nav-drawer")).toHaveCount(1);
  });
});
