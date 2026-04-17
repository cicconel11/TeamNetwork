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
   * Get the E2E test organization UUID. Required by mentorship API routes,
   * which accept the organization UUID (not slug) in their paths.
   */
  getOrgId: () => process.env.E2E_ORG_ID || "",

  /**
   * Get a secondary org UUID used to verify cross-org isolation.
   */
  getOtherOrgId: () => process.env.E2E_OTHER_ORG_ID || "",

  /**
   * Mentor test user — must be an active_member of E2E_ORG_ID with a
   * mentor_profiles row (is_active=true, accepting_new=true).
   */
  getMentorCredentials: () => ({
    email: process.env.E2E_MENTOR_EMAIL || "e2e-mentor@test.local",
    password: process.env.E2E_MENTOR_PASSWORD || "e2e-mentor-password",
    userId: process.env.E2E_MENTOR_USER_ID || "",
  }),

  /**
   * Mentee test user — must be an active_member of E2E_ORG_ID.
   */
  getMenteeCredentials: () => ({
    email: process.env.E2E_MENTEE_EMAIL || "e2e-mentee@test.local",
    password: process.env.E2E_MENTEE_PASSWORD || "e2e-mentee-password",
    userId: process.env.E2E_MENTEE_USER_ID || "",
  }),

  /**
   * Admin user ID (the user authenticated via auth.setup.ts). Used when
   * seeding tests that need to reference the admin's user_id.
   */
  getAdminUserId: () => process.env.E2E_ADMIN_USER_ID || "",

  /**
   * Cron secret for authorizing /api/cron/* endpoints.
   */
  getCronSecret: () => process.env.CRON_SECRET || "",

  /**
   * Generate a unique alumni with random data
   */
  generateAlumni: () => {
    const id = randomUUID().slice(0, 8);
    return {
      firstName: `TestAlumni-${id}`,
      lastName: `E2E-${id}`,
      email: `test-alumni-${id}@e2e.local`,
      graduationYear: "2020",
    };
  },

  /**
   * Generate a unique event with random data
   */
  generateEvent: () => {
    const id = randomUUID().slice(0, 8);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    return {
      title: `Test Event ${id}`,
      startDate: tomorrow,
      location: `Test Location ${id}`,
    };
  },

  /**
   * Generate an invalid email for error testing
   */
  invalidEmail: "not-an-email",

  /**
   * Generate a weak password for validation testing
   */
  weakPassword: "123",
};
