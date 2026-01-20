/**
 * Tests for mobile app routing structure.
 * These tests validate that key route files exist and navigation patterns are consistent.
 */

import test from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_APP_ROOT = path.resolve(__dirname, "../../mobile");
const APP_ROUTES = path.join(MOBILE_APP_ROOT, "app");

/**
 * Helper to check if a file exists
 */
function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Helper to read file content
 */
function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Test: Critical route files exist
 */
test("Critical mobile route files exist", async (t) => {
  const criticalRoutes = [
    // Root layouts
    "app/_layout.tsx",
    "app/(auth)/_layout.tsx",
    "app/(app)/_layout.tsx",

    // Auth screens
    "app/(auth)/index.tsx",
    "app/(auth)/login.tsx",
    "app/(auth)/signup.tsx",

    // Main app screens
    "app/(app)/index.tsx",
    "app/(app)/[orgSlug]/_layout.tsx",
    "app/(app)/[orgSlug]/(tabs)/_layout.tsx",

    // Tab screens
    "app/(app)/[orgSlug]/(tabs)/index.tsx",
    "app/(app)/[orgSlug]/(tabs)/events.tsx",
    "app/(app)/[orgSlug]/(tabs)/announcements.tsx",
    "app/(app)/[orgSlug]/(tabs)/members.tsx",
    "app/(app)/[orgSlug]/(tabs)/menu.tsx",

    // Detail screens
    "app/(app)/[orgSlug]/events/[eventId].tsx",
    "app/(app)/[orgSlug]/announcements/[announcementId].tsx",
    "app/(app)/[orgSlug]/members/[memberId].tsx",
  ];

  for (const route of criticalRoutes) {
    await t.test(`Route file exists: ${route}`, () => {
      const fullPath = path.join(MOBILE_APP_ROOT, route);
      assert.ok(fileExists(fullPath), `Route file should exist: ${route}`);
    });
  }
});

/**
 * Test: Member detail route is navigable from members list
 */
test("Member detail route is linked from members list", async (t) => {
  await t.test("Members list navigates to member detail screen", () => {
    const membersListPath = path.join(
      MOBILE_APP_ROOT,
      "app/(app)/[orgSlug]/(tabs)/members.tsx"
    );

    assert.ok(fileExists(membersListPath), "Members list file should exist");

    const content = readFile(membersListPath);

    // Check that the members list navigates to the detail screen
    assert.ok(
      content.includes("router.push") && content.includes("members/"),
      "Members list should have navigation to member detail"
    );

    // Check it uses the correct route pattern
    assert.ok(
      content.includes("members/${item.id}") ||
        content.includes('members/" + item.id') ||
        content.includes("`/(app)/${orgSlug}/members/${item.id}`"),
      "Members list should navigate using member id"
    );
  });

  await t.test("Member detail screen fetches member data", () => {
    const memberDetailPath = path.join(
      MOBILE_APP_ROOT,
      "app/(app)/[orgSlug]/members/[memberId].tsx"
    );

    assert.ok(fileExists(memberDetailPath), "Member detail file should exist");

    const content = readFile(memberDetailPath);

    // Check that it reads the memberId param
    assert.ok(
      content.includes("memberId") && content.includes("useLocalSearchParams"),
      "Member detail should read memberId from params"
    );

    // Check that it fetches member data
    assert.ok(
      content.includes("supabase") && content.includes("user_organization_roles"),
      "Member detail should fetch from user_organization_roles"
    );
  });
});

/**
 * Test: Event detail route is navigable from events list
 */
test("Event detail route is linked from events list", async (t) => {
  await t.test("Events list navigates to event detail screen", () => {
    const eventsListPath = path.join(
      MOBILE_APP_ROOT,
      "app/(app)/[orgSlug]/(tabs)/events.tsx"
    );

    assert.ok(fileExists(eventsListPath), "Events list file should exist");

    const content = readFile(eventsListPath);

    // Check that events list navigates to detail screen
    assert.ok(
      content.includes("router.push") && content.includes("events/"),
      "Events list should have navigation to event detail"
    );
  });
});

/**
 * Test: Announcement detail route is navigable from announcements list
 */
test("Announcement detail route is linked from announcements list", async (t) => {
  await t.test("Announcements list navigates to announcement detail screen", () => {
    const announcementsListPath = path.join(
      MOBILE_APP_ROOT,
      "app/(app)/[orgSlug]/(tabs)/announcements.tsx"
    );

    assert.ok(
      fileExists(announcementsListPath),
      "Announcements list file should exist"
    );

    const content = readFile(announcementsListPath);

    // Check that announcements list navigates to detail screen
    assert.ok(
      content.includes("router.push") && content.includes("announcements/"),
      "Announcements list should have navigation to announcement detail"
    );
  });
});

/**
 * Test: Key hooks exist
 */
test("Key mobile hooks exist", async (t) => {
  const criticalHooks = [
    "src/hooks/useAuth.ts",
    "src/hooks/useMembers.ts",
    "src/hooks/useEvents.ts",
    "src/hooks/useAnnouncements.ts",
    "src/hooks/useAlumni.ts",
    "src/hooks/useOrgRole.ts",
  ];

  for (const hook of criticalHooks) {
    await t.test(`Hook exists: ${hook}`, () => {
      const fullPath = path.join(MOBILE_APP_ROOT, hook);
      assert.ok(fileExists(fullPath), `Hook file should exist: ${hook}`);
    });
  }
});

/**
 * Test: Permission and feature flag helpers exist
 */
test("Permission and feature flag helpers exist", async (t) => {
  const criticalLibFiles = [
    "src/lib/permissions.ts",
    "src/lib/featureFlags.ts",
  ];

  for (const libFile of criticalLibFiles) {
    await t.test(`Lib file exists: ${libFile}`, () => {
      const fullPath = path.join(MOBILE_APP_ROOT, libFile);
      assert.ok(fileExists(fullPath), `Lib file should exist: ${libFile}`);
    });
  }

  await t.test("Permissions file exports canViewAlumni", () => {
    const permissionsPath = path.join(MOBILE_APP_ROOT, "src/lib/permissions.ts");
    const content = readFile(permissionsPath);
    assert.ok(
      content.includes("canViewAlumni"),
      "Permissions should export canViewAlumni"
    );
  });

  await t.test("Permissions file exports canUseAdminActions", () => {
    const permissionsPath = path.join(MOBILE_APP_ROOT, "src/lib/permissions.ts");
    const content = readFile(permissionsPath);
    assert.ok(
      content.includes("canUseAdminActions"),
      "Permissions should export canUseAdminActions"
    );
  });
});

/**
 * Test: OverflowMenu component exists
 */
test("OverflowMenu component exists", async (t) => {
  await t.test("OverflowMenu component file exists", () => {
    const overflowMenuPath = path.join(
      MOBILE_APP_ROOT,
      "src/components/OverflowMenu.tsx"
    );
    assert.ok(fileExists(overflowMenuPath), "OverflowMenu component should exist");
  });

  await t.test("OverflowMenu is exported", () => {
    const overflowMenuPath = path.join(
      MOBILE_APP_ROOT,
      "src/components/OverflowMenu.tsx"
    );
    const content = readFile(overflowMenuPath);
    assert.ok(
      content.includes("export function OverflowMenu") ||
        content.includes("export default OverflowMenu"),
      "OverflowMenu should be exported"
    );
  });
});
