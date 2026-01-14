import { randomUUID } from "crypto";

/**
 * Test data factories for E2E tests.
 * Generates unique data for each test run to avoid conflicts.
 */

export const TestData = {
  /**
   * Generate a unique member with random data
   */
  generateMember: () => {
    const id = randomUUID().slice(0, 8);
    return {
      firstName: `Test${id}`,
      lastName: `Member${id}`,
      email: `test-${id}@test.local`,
      role: "Test Role",
      status: "active" as const,
    };
  },

  /**
   * Generate a unique user for signup tests
   */
  generateUser: () => {
    const id = randomUUID().slice(0, 8);
    return {
      name: `Test User ${id}`,
      email: `test-user-${id}@test.local`,
      password: `TestPass123!${id}`,
    };
  },

  /**
   * Get E2E admin credentials from environment
   */
  getAdminCredentials: () => ({
    email: process.env.E2E_ADMIN_EMAIL || "e2e-admin@test.local",
    password: process.env.E2E_ADMIN_PASSWORD || "e2e-admin-password",
  }),

  /**
   * Get the E2E test organization slug
   */
  getOrgSlug: () => process.env.E2E_ORG_SLUG || "e2e-test-org",

  /**
   * Generate an invalid email for error testing
   */
  invalidEmail: "not-an-email",

  /**
   * Generate a weak password for validation testing
   */
  weakPassword: "123",
};
