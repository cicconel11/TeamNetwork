import { test, expect } from "@playwright/test";
import { MemberFormPage, MemberDetailPage, MemberListPage } from "../page-objects/MemberFormPage";
import { TestData } from "../fixtures/test-data";

test.describe("Member CRUD Operations", () => {
  const orgSlug = TestData.getOrgSlug();

  test.describe("Create Member", () => {
    test("creates a new member with required fields", async ({ page }) => {
      const memberFormPage = new MemberFormPage(page);
      const memberListPage = new MemberListPage(page);
      const memberData = TestData.generateMember();

      // Navigate to new member form
      await memberFormPage.gotoNew(orgSlug);

      // Fill and submit the form
      await memberFormPage.createMember(memberData);

      // Should redirect to members list
      await page.waitForURL((url) => url.pathname.includes("/members") && !url.pathname.includes("/new"), {
        timeout: 30000,
      });

      // Verify member appears in list
      await memberListPage.goto(orgSlug);
      const exists = await memberListPage.memberExists(memberData.firstName, memberData.lastName);
      expect(exists).toBe(true);
    });

    test("shows validation error for missing required fields", async ({ page }) => {
      const memberFormPage = new MemberFormPage(page);

      await memberFormPage.gotoNew(orgSlug);

      // Try to submit empty form
      await memberFormPage.submit();

      // Form should not submit - check we're still on the new member page
      expect(page.url()).toContain("/members/new");

      // Check for HTML5 validation on first name (required field)
      const firstNameInput = memberFormPage.getByTestId("member-first-name");
      const validationMessage = await firstNameInput.evaluate(
        (el: HTMLInputElement) => el.validationMessage
      );
      expect(validationMessage).not.toBe("");
    });
  });

  test.describe("Read Member", () => {
    test("displays member list", async ({ page }) => {
      const memberListPage = new MemberListPage(page);

      await memberListPage.goto(orgSlug);

      // Page should load without errors
      await expect(page.locator("main")).toBeVisible();

      // Should have some content (either members or empty state)
      const hasContent = await page.locator("main").textContent();
      expect(hasContent).toBeTruthy();
    });
  });

  test.describe("Update Member", () => {
    test("updates member profile", async ({ page }) => {
      const memberFormPage = new MemberFormPage(page);
      const memberListPage = new MemberListPage(page);
      const memberData = TestData.generateMember();
      const updatedLastName = `Updated${memberData.lastName}`;

      // First create a member
      await memberFormPage.gotoNew(orgSlug);
      await memberFormPage.createMember(memberData);

      // Wait for redirect to list
      await page.waitForURL((url) => url.pathname.includes("/members") && !url.pathname.includes("/new"), {
        timeout: 30000,
      });

      // Navigate to member list and find the member
      await memberListPage.goto(orgSlug);
      await memberListPage.clickMember(memberData.firstName, memberData.lastName);

      // Wait for detail page
      await page.waitForURL((url) => url.pathname.includes("/members/"), {
        timeout: 30000,
      });

      // Click edit button
      const memberDetailPage = new MemberDetailPage(page);
      await memberDetailPage.clickEdit();

      // Wait for edit page
      await page.waitForURL((url) => url.pathname.includes("/edit"), {
        timeout: 30000,
      });

      // Update last name using edit form testids
      await page.locator('[data-testid="member-edit-last-name"]').fill(updatedLastName);
      await page.locator('[data-testid="member-edit-submit"]').click();

      // Should redirect back to detail page
      await page.waitForURL((url) => url.pathname.includes("/members/") && !url.pathname.includes("/edit"), {
        timeout: 30000,
      });

      // Verify the updated name is displayed
      await expect(page.locator(`text=${updatedLastName}`)).toBeVisible();
    });
  });

  test.describe("Delete Member", () => {
    test("soft deletes a member", async ({ page }) => {
      const memberFormPage = new MemberFormPage(page);
      const memberListPage = new MemberListPage(page);
      const memberDetailPage = new MemberDetailPage(page);
      const memberData = TestData.generateMember();

      // First create a member
      await memberFormPage.gotoNew(orgSlug);
      await memberFormPage.createMember(memberData);

      // Wait for redirect
      await page.waitForURL((url) => url.pathname.includes("/members") && !url.pathname.includes("/new"), {
        timeout: 30000,
      });

      // Navigate to member and click on them
      await memberListPage.goto(orgSlug);
      await memberListPage.clickMember(memberData.firstName, memberData.lastName);

      // Wait for detail page
      await page.waitForURL((url) => url.pathname.includes("/members/"), {
        timeout: 30000,
      });

      // Set up dialog handler before clicking delete
      page.on("dialog", async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        await dialog.accept();
      });

      // Click delete button
      await memberDetailPage.clickDelete();

      // Should redirect to members list
      await page.waitForURL((url) => url.pathname === `/${orgSlug}/members`, {
        timeout: 30000,
      });

      // Verify member is no longer in list
      const exists = await memberListPage.memberExists(memberData.firstName, memberData.lastName);
      expect(exists).toBe(false);
    });

    test("cancels delete on dismiss", async ({ page }) => {
      const memberFormPage = new MemberFormPage(page);
      const memberListPage = new MemberListPage(page);
      const memberDetailPage = new MemberDetailPage(page);
      const memberData = TestData.generateMember();

      // First create a member
      await memberFormPage.gotoNew(orgSlug);
      await memberFormPage.createMember(memberData);

      // Wait for redirect
      await page.waitForURL((url) => url.pathname.includes("/members") && !url.pathname.includes("/new"), {
        timeout: 30000,
      });

      // Navigate to member detail
      await memberListPage.goto(orgSlug);
      await memberListPage.clickMember(memberData.firstName, memberData.lastName);

      // Wait for detail page
      await page.waitForURL((url) => url.pathname.includes("/members/"), {
        timeout: 30000,
      });

      const detailUrl = page.url();

      // Set up dialog handler to dismiss
      page.on("dialog", async (dialog) => {
        await dialog.dismiss();
      });

      // Click delete button
      await memberDetailPage.clickDelete();

      // Should stay on the same page
      expect(page.url()).toBe(detailUrl);

      // Member detail should still be visible
      await memberDetailPage.expectVisible();
    });
  });
});
