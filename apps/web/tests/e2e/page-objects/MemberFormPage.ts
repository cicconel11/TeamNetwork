import { Page, expect } from "@playwright/test";
import { BasePage } from "./BasePage";

interface MemberData {
  firstName: string;
  lastName: string;
  email?: string;
  role?: string;
  status?: "active" | "inactive";
}

/**
 * Page object for member form pages (new and edit)
 */
export class MemberFormPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to the new member page
   */
  async gotoNew(orgSlug: string): Promise<void> {
    await this.page.goto(`/${orgSlug}/members/new`);
    await this.waitForNavigation();
  }

  /**
   * Navigate to the edit member page
   */
  async gotoEdit(orgSlug: string, memberId: string): Promise<void> {
    await this.page.goto(`/${orgSlug}/members/${memberId}/edit`);
    await this.waitForNavigation();
  }

  /**
   * Fill in the first name field
   */
  async fillFirstName(firstName: string): Promise<void> {
    await this.getByTestId("member-first-name").fill(firstName);
  }

  /**
   * Fill in the last name field
   */
  async fillLastName(lastName: string): Promise<void> {
    await this.getByTestId("member-last-name").fill(lastName);
  }

  /**
   * Fill in the email field
   */
  async fillEmail(email: string): Promise<void> {
    await this.getByTestId("member-email").fill(email);
  }

  /**
   * Fill in the role field
   */
  async fillRole(role: string): Promise<void> {
    await this.getByTestId("member-role").fill(role);
  }

  /**
   * Select the status
   */
  async selectStatus(status: "active" | "inactive"): Promise<void> {
    await this.getByTestId("member-status").selectOption(status);
  }

  /**
   * Click the submit button
   */
  async submit(): Promise<void> {
    await this.getByTestId("member-submit").click();
  }

  /**
   * Click the cancel button
   */
  async cancel(): Promise<void> {
    await this.getByTestId("member-cancel").click();
  }

  /**
   * Fill the entire form with member data
   */
  async fillForm(data: MemberData): Promise<void> {
    await this.fillFirstName(data.firstName);
    await this.fillLastName(data.lastName);
    if (data.email) {
      await this.fillEmail(data.email);
    }
    if (data.role) {
      await this.fillRole(data.role);
    }
    if (data.status) {
      await this.selectStatus(data.status);
    }
  }

  /**
   * Create a new member by filling and submitting the form
   */
  async createMember(data: MemberData): Promise<void> {
    await this.fillForm(data);
    await this.submit();
  }

  /**
   * Get the error message element
   */
  get errorMessage() {
    return this.getByTestId("member-error");
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
}

/**
 * Page object for member detail page
 */
export class MemberDetailPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to a member's detail page
   */
  async goto(orgSlug: string, memberId: string): Promise<void> {
    await this.page.goto(`/${orgSlug}/members/${memberId}`);
    await this.waitForNavigation();
  }

  /**
   * Get the member detail container
   */
  get detailContainer() {
    return this.getByTestId("member-detail");
  }

  /**
   * Click the edit button
   */
  async clickEdit(): Promise<void> {
    await this.getByTestId("member-edit-button").click();
  }

  /**
   * Click the delete button
   */
  async clickDelete(): Promise<void> {
    await this.getByTestId("member-delete-button").click();
  }

  /**
   * Assert the detail page is visible
   */
  async expectVisible(): Promise<void> {
    await expect(this.detailContainer).toBeVisible();
  }
}

/**
 * Page object for member list page
 */
export class MemberListPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to the members list page
   */
  async goto(orgSlug: string): Promise<void> {
    await this.page.goto(`/${orgSlug}/members`);
    await this.waitForNavigation();
  }

  /**
   * Check if a member is visible in the list by name
   */
  async memberExists(firstName: string, lastName: string): Promise<boolean> {
    const fullName = `${firstName} ${lastName}`;
    return (await this.page.locator(`text=${fullName}`).count()) > 0;
  }

  /**
   * Click on a member in the list
   */
  async clickMember(firstName: string, lastName: string): Promise<void> {
    const fullName = `${firstName} ${lastName}`;
    await this.page.locator(`text=${fullName}`).first().click();
  }
}
