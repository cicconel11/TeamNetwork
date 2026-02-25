import test from "node:test";
import assert from "node:assert";

/**
 * Tests for sanitizeNavConfig logic — replicated inline from:
 *   src/app/api/organizations/[organizationId]/route.ts
 *
 * Verifies backend correctly handles the 'parent' role in hiddenForRoles and editRoles.
 * The function is pure (no Next.js deps), so we replicate it here with the same constants.
 */

// ----- Replicated constants -----

type OrgRole = "admin" | "active_member" | "alumni" | "parent";

const ALLOWED_ROLES = ["admin", "active_member", "alumni", "parent"] as const;

// All hrefs from ORG_NAV_ITEMS plus "dashboard" (the special key for the Dashboard item)
const ALLOWED_NAV_PATHS = new Set([
  "",
  "/members",
  "/chat",
  "/feed",
  "/alumni",
  "/parents",
  "/mentorship",
  "/workouts",
  "/competition",
  "/events",
  "/announcements",
  "/philanthropy",
  "/donations",
  "/expenses",
  "/records",
  "/calendar",
  "/discussions",
  "/jobs",
  "/forms",
  "/media",
  "/customization",
  "/settings/invites",
  "/settings/navigation",
  "dashboard",
]);

type NavConfigEntry = {
  label?: string;
  hidden?: boolean;
  hiddenForRoles?: OrgRole[];
  editRoles?: OrgRole[];
  order?: number;
};

type NavConfig = Record<string, NavConfigEntry>;

// ----- Replicated function -----

function sanitizeNavConfig(payload: unknown): NavConfig {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const config: NavConfig = {};
  for (const [href, value] of Object.entries(payload as Record<string, unknown>)) {
    if (
      !ALLOWED_NAV_PATHS.has(href) ||
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    )
      continue;

    const entry = value as {
      label?: unknown;
      hidden?: unknown;
      hiddenForRoles?: unknown;
      editRoles?: unknown;
      order?: unknown;
    };
    const clean: {
      label?: string;
      hidden?: boolean;
      hiddenForRoles?: OrgRole[];
      editRoles?: OrgRole[];
      order?: number;
    } = {};

    if (typeof entry.label === "string" && entry.label.trim()) {
      clean.label = entry.label.trim();
    }
    if (entry.hidden === true) {
      clean.hidden = true;
    }
    if (Array.isArray(entry.hiddenForRoles)) {
      const roles = entry.hiddenForRoles.filter((role): role is OrgRole =>
        ALLOWED_ROLES.includes(role as OrgRole)
      );
      if (roles.length) {
        clean.hiddenForRoles = Array.from(new Set(roles));
      }
    }
    if (Array.isArray(entry.editRoles)) {
      const roles = entry.editRoles.filter((role): role is OrgRole =>
        ALLOWED_ROLES.includes(role as OrgRole)
      );
      if (roles.length) {
        clean.editRoles = Array.from(new Set([...roles, "admin"] as OrgRole[]));
      }
    }
    if (
      typeof entry.order === "number" &&
      Number.isInteger(entry.order) &&
      entry.order >= 0
    ) {
      clean.order = entry.order;
    }

    if (Object.keys(clean).length > 0) {
      config[href] = clean;
    }
  }

  return config;
}

// ----- Tests -----

test("sanitizeNavConfig: parent in hiddenForRoles is preserved", () => {
  const result = sanitizeNavConfig({ "/members": { hiddenForRoles: ["parent"] } });
  assert.deepStrictEqual(result["/members"]?.hiddenForRoles, ["parent"]);
});

test("sanitizeNavConfig: parent in editRoles is preserved and admin is forced", () => {
  const result = sanitizeNavConfig({ "/members": { editRoles: ["parent"] } });
  const editRoles = result["/members"]?.editRoles ?? [];
  assert.ok(editRoles.includes("parent"), "parent should be in editRoles");
  assert.ok(editRoles.includes("admin"), "admin should be forced into editRoles");
});

test("sanitizeNavConfig: parent alongside alumni and active_member all preserved", () => {
  const result = sanitizeNavConfig({
    "/members": { hiddenForRoles: ["parent", "alumni", "active_member"] },
  });
  const hiddenForRoles = result["/members"]?.hiddenForRoles ?? [];
  assert.ok(hiddenForRoles.includes("parent"), "parent should be preserved");
  assert.ok(hiddenForRoles.includes("alumni"), "alumni should be preserved");
  assert.ok(hiddenForRoles.includes("active_member"), "active_member should be preserved");
  assert.strictEqual(hiddenForRoles.length, 3, "should have exactly 3 roles");
});

test("sanitizeNavConfig: invalid role superadmin is stripped even when parent is present", () => {
  const result = sanitizeNavConfig({
    "/members": { hiddenForRoles: ["parent", "superadmin"] },
  });
  const hiddenForRoles = result["/members"]?.hiddenForRoles ?? [];
  assert.ok(hiddenForRoles.includes("parent"), "parent should be preserved");
  assert.ok(!hiddenForRoles.includes("superadmin"), "superadmin should be stripped");
  assert.strictEqual(hiddenForRoles.length, 1, "only parent should remain");
});

test("sanitizeNavConfig: empty hiddenForRoles array omits key from output", () => {
  const result = sanitizeNavConfig({ "/members": { hiddenForRoles: [] } });
  assert.ok(!result["/members"], "entry with only empty hiddenForRoles should be omitted entirely");
});

test("sanitizeNavConfig: editRoles with only parent produces [parent, admin] deduped", () => {
  const result = sanitizeNavConfig({ "/members": { editRoles: ["parent"] } });
  const editRoles = result["/members"]?.editRoles ?? [];
  assert.strictEqual(editRoles.length, 2, "should have exactly 2 roles");
  assert.ok(editRoles.includes("parent"), "parent should be present");
  assert.ok(editRoles.includes("admin"), "admin should be present");
});

test("sanitizeNavConfig: editRoles with [admin, parent] deduped, admin not doubled", () => {
  const result = sanitizeNavConfig({ "/members": { editRoles: ["admin", "parent"] } });
  const editRoles = result["/members"]?.editRoles ?? [];
  const adminCount = editRoles.filter((r) => r === "admin").length;
  assert.strictEqual(adminCount, 1, "admin should appear exactly once");
  assert.ok(editRoles.includes("parent"), "parent should be present");
  assert.strictEqual(editRoles.length, 2, "should have exactly 2 roles");
});

test("sanitizeNavConfig: valid nav path /members is preserved", () => {
  const result = sanitizeNavConfig({ "/members": { hidden: true } });
  assert.ok(result["/members"], "/members should be in output");
  assert.strictEqual(result["/members"]?.hidden, true);
});

test("sanitizeNavConfig: unknown path /nonexistent is dropped", () => {
  const result = sanitizeNavConfig({ "/nonexistent": { hidden: true } });
  assert.ok(!result["/nonexistent"], "/nonexistent should be dropped");
});

test("sanitizeNavConfig: dashboard key is accepted", () => {
  const result = sanitizeNavConfig({ "dashboard": { hidden: true } });
  assert.ok(result["dashboard"], "dashboard key should be accepted");
  assert.strictEqual(result["dashboard"]?.hidden, true);
});
