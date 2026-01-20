/**
 * Tests for mobile menu parity with feature flags.
 * These tests validate that hidden modules are not present in the menu when flags/roles don't allow them.
 */

import test from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_APP_ROOT = path.resolve(__dirname, "../../mobile");

/**
 * Helper to read file content
 */
function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Test: Menu screen gates Community items behind feature flags
 */
test("Menu screen gates community items behind feature flags", async (t) => {
  const menuPath = path.join(
    MOBILE_APP_ROOT,
    "app/(app)/[orgSlug]/(tabs)/menu.tsx"
  );

  const content = readFile(menuPath);

  await t.test("Menu uses useOrgRole hook for permissions", () => {
    assert.ok(
      content.includes("useOrgRole"),
      "Menu should import and use useOrgRole hook"
    );
  });

  await t.test("Menu conditionally builds communityItems based on permissions", () => {
    // Check that communityItems is built conditionally
    assert.ok(
      content.includes("permissions.canViewDonations") ||
        content.includes("canViewDonations"),
      "Menu should check canViewDonations permission"
    );
  });

  await t.test("Menu only shows Community section when items exist", () => {
    // Check that Community section is conditionally rendered
    assert.ok(
      content.includes("communityItems.length > 0") ||
        content.includes("communityItems.length"),
      "Menu should only show Community section when there are items"
    );
  });

  await t.test("Admin section is gated behind isAdmin check", () => {
    assert.ok(
      content.includes("isAdmin") && content.includes("Admin"),
      "Menu should gate Admin section behind isAdmin check"
    );
  });
});

/**
 * Test: Home screen does not show Donations stat (hidden until feature is ready)
 */
test("Home screen hides Donations stat", async (t) => {
  const homePath = path.join(
    MOBILE_APP_ROOT,
    "app/(app)/[orgSlug]/(tabs)/index.tsx"
  );

  const content = readFile(homePath);

  await t.test("Home screen does not display hardcoded Donations stat", () => {
    // The donations stat with hardcoded "0" should not be present
    const hasDonationsStat =
      content.includes("Donations") &&
      content.includes("statItem") &&
      content.includes("Heart");

    assert.ok(
      !hasDonationsStat,
      "Home screen should not display Donations stat (feature not ready)"
    );
  });

  await t.test("Home screen shows Members and Events stats", () => {
    assert.ok(content.includes("Members"), "Home should show Members stat");
    assert.ok(content.includes("Events"), "Home should show Events stat");
  });
});

/**
 * Test: Members screen gates alumni tab behind permission
 */
test("Members screen gates alumni tab", async (t) => {
  const membersPath = path.join(
    MOBILE_APP_ROOT,
    "app/(app)/[orgSlug]/(tabs)/members.tsx"
  );

  const content = readFile(membersPath);

  await t.test("Members screen uses useOrgRole hook", () => {
    assert.ok(
      content.includes("useOrgRole"),
      "Members screen should import and use useOrgRole hook"
    );
  });

  await t.test("Members screen checks canViewAlumni permission", () => {
    assert.ok(
      content.includes("canViewAlumni") || content.includes("permissions.canViewAlumni"),
      "Members screen should check canViewAlumni permission"
    );
  });

  await t.test("Tab switcher is conditionally rendered based on alumni permission", () => {
    // The tab switcher should only show when canViewAlumni is true
    assert.ok(
      content.includes("canViewAlumni") && content.includes("tabContainer"),
      "Tab switcher should be gated by canViewAlumni"
    );
  });
});

/**
 * Test: Events screen has admin overflow menu
 */
test("Events screen has admin overflow menu", async (t) => {
  const eventsPath = path.join(
    MOBILE_APP_ROOT,
    "app/(app)/[orgSlug]/(tabs)/events.tsx"
  );

  const content = readFile(eventsPath);

  await t.test("Events screen imports OverflowMenu", () => {
    assert.ok(
      content.includes("OverflowMenu"),
      "Events screen should import OverflowMenu"
    );
  });

  await t.test("Events screen uses useOrgRole for permissions", () => {
    assert.ok(
      content.includes("useOrgRole"),
      "Events screen should use useOrgRole hook"
    );
  });

  await t.test("Events screen creates admin menu items based on permissions", () => {
    assert.ok(
      content.includes("adminMenuItems") || content.includes("canUseAdminActions"),
      "Events screen should create admin menu items based on permissions"
    );
  });
});

/**
 * Test: Announcements screen has admin overflow menu
 */
test("Announcements screen has admin overflow menu", async (t) => {
  const announcementsPath = path.join(
    MOBILE_APP_ROOT,
    "app/(app)/[orgSlug]/(tabs)/announcements.tsx"
  );

  const content = readFile(announcementsPath);

  await t.test("Announcements screen imports OverflowMenu", () => {
    assert.ok(
      content.includes("OverflowMenu"),
      "Announcements screen should import OverflowMenu"
    );
  });

  await t.test("Announcements screen uses useOrgRole for permissions", () => {
    assert.ok(
      content.includes("useOrgRole"),
      "Announcements screen should use useOrgRole hook"
    );
  });

  await t.test("Announcements screen creates admin menu items based on permissions", () => {
    assert.ok(
      content.includes("adminMenuItems") || content.includes("canUseAdminActions"),
      "Announcements screen should create admin menu items based on permissions"
    );
  });
});

/**
 * Test: Feature flags module exists and is properly structured
 */
test("Feature flags module structure", async (t) => {
  const featureFlagsPath = path.join(
    MOBILE_APP_ROOT,
    "src/lib/featureFlags.ts"
  );

  const content = readFile(featureFlagsPath);

  await t.test("Feature flags exports alumniEnabled flag", () => {
    assert.ok(
      content.includes("alumniEnabled"),
      "Feature flags should include alumniEnabled"
    );
  });

  await t.test("Feature flags exports donationsEnabled flag", () => {
    assert.ok(
      content.includes("donationsEnabled"),
      "Feature flags should include donationsEnabled"
    );
  });

  await t.test("Feature flags exports recordsEnabled flag", () => {
    assert.ok(
      content.includes("recordsEnabled"),
      "Feature flags should include recordsEnabled"
    );
  });

  await t.test("Feature flags exports formsEnabled flag", () => {
    assert.ok(
      content.includes("formsEnabled"),
      "Feature flags should include formsEnabled"
    );
  });

  await t.test("Feature flags exports getFeatureFlags function", () => {
    assert.ok(
      content.includes("export function getFeatureFlags"),
      "Feature flags should export getFeatureFlags function"
    );
  });
});
