import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Source-grep tests asserting that Members / Alumni / Parents directory
 * + detail pages route their "who can edit this person?" + "what badge
 * do we render?" decisions through the unified `getPersonAdminContext`
 * helper, instead of per-page `isOrgAdmin` / `getOrgRole` /
 * `canEditNavItem` / local `orgRoleLabels` lookups. Also asserts the
 * read-only billing gate has been extended to the member detail page
 * for symmetry with alumni detail.
 *
 * Parent detail (`/parents/[parentId]`) is intentionally NOT changed in
 * this PR; the parents directory still flips to `getPersonAdminContext`.
 */

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

// ─── Members directory ────────────────────────────────────────────────

test("members directory imports getPersonAdminContext", () => {
  const source = readSource("src/app/[orgSlug]/members/page.tsx");
  assert.match(source, /from "@\/lib\/people\/permissions"/);
  assert.match(source, /getPersonAdminContext/);
});

test("members directory derives adminUserIds from personCtx, not a per-page query", () => {
  const source = readSource("src/app/[orgSlug]/members/page.tsx");
  assert.match(source, /adminUserIds = personCtx\.adminUserIds/);
});

test("members directory renders org-role badge via personCtx.orgRoleLabelFor", () => {
  const source = readSource("src/app/[orgSlug]/members/page.tsx");
  assert.match(source, /personCtx\.orgRoleLabelFor\(member\.user_id\)/);
});

test("members directory uses formatPersonHeadline for headline rendering", () => {
  const source = readSource("src/app/[orgSlug]/members/page.tsx");
  assert.match(source, /formatPersonHeadline\(\{[^}]*current_company: member\.current_company/s);
});

test("members directory SELECT widens to include current_company, current_city, school", () => {
  const source = readSource("src/app/[orgSlug]/members/page.tsx");
  assert.match(source, /current_company, current_city, school/);
});

test("members directory shows Parent badge for parent-source rows", () => {
  const source = readSource("src/app/[orgSlug]/members/page.tsx");
  assert.match(source, /member\.isParent && \(/);
  assert.match(source, /<Badge variant="primary">Parent<\/Badge>/);
});

// ─── Member detail ────────────────────────────────────────────────────

test("member detail imports getPersonAdminContext and drops isOrgAdmin", () => {
  const source = readSource("src/app/[orgSlug]/members/[memberId]/page.tsx");
  assert.match(source, /from "@\/lib\/people\/permissions"/);
  assert.match(source, /getPersonAdminContext/);
  assert.doesNotMatch(source, /import \{ isOrgAdmin \} from "@\/lib\/auth"/);
});

test("member detail derives canEdit via ctx.canEditPerson(memberUserId)", () => {
  const source = readSource("src/app/[orgSlug]/members/[memberId]/page.tsx");
  assert.match(source, /const canEdit = ctx\.canEditPerson\(memberUserId\)/);
});

test("member detail extends the read-only billing gate to existing edits + delete", () => {
  const source = readSource("src/app/[orgSlug]/members/[memberId]/page.tsx");
  assert.match(source, /const canModifyExisting = canEdit && !ctx\.isReadOnly/);
  assert.match(source, /const canDelete = ctx\.isAdmin && !ctx\.isReadOnly/);
});

test("member detail shows Edit Disabled / Delete Disabled UX when in read-only", () => {
  const source = readSource("src/app/[orgSlug]/members/[memberId]/page.tsx");
  assert.match(source, /data-testid="member-edit-disabled"/);
  assert.match(source, /data-testid="member-delete-disabled"/);
});

test("member detail renders the read-only billing banner", () => {
  const source = readSource("src/app/[orgSlug]/members/[memberId]/page.tsx");
  assert.match(source, /\{ctx\.isReadOnly && \(/);
  assert.match(source, /billing grace period/);
});

test("member detail uses ctx.orgRoleLabelFor and drops the local orgRoleLabels map", () => {
  const source = readSource("src/app/[orgSlug]/members/[memberId]/page.tsx");
  assert.match(source, /ctx\.orgRoleLabelFor\(memberUserId\)/);
  assert.doesNotMatch(source, /const orgRoleLabels: Record<string, string>/);
});

test("member detail uses formatPersonHeadline for hero headline", () => {
  const source = readSource("src/app/[orgSlug]/members/[memberId]/page.tsx");
  assert.match(source, /formatPersonHeadline\(\{[^}]*role: jobTitle/s);
});

test("member detail redirects alumni-role users to the alumni profile", () => {
  const source = readSource("src/app/[orgSlug]/members/[memberId]/page.tsx");
  assert.match(source, /userOrgRole === "alumni"/);
  assert.match(source, /redirect\(`\/\$\{orgSlug\}\/alumni\/\$\{alumniRow\.id\}`\)/);
});

// ─── Alumni directory ─────────────────────────────────────────────────

test("alumni directory keeps nav edit roles for page-level actions", () => {
  const source = readSource("src/app/[orgSlug]/alumni/page.tsx");
  assert.match(source, /import \{ getOrgRole \}/);
  assert.match(source, /import \{ canEditNavItem \}/);
  assert.match(source, /canEditNavItem\(navConfig, "\/alumni", role, \["admin"\]\)/);
});

test("alumni directory uses formatPersonHeadline for card headline", () => {
  const source = readSource("src/app/[orgSlug]/alumni/page.tsx");
  assert.match(source, /formatPersonHeadline\(/);
});

// ─── Alumni detail ────────────────────────────────────────────────────

test("alumni detail keeps nav edit roles and imports getPersonAdminContext", () => {
  const source = readSource("src/app/[orgSlug]/alumni/[alumniId]/page.tsx");
  assert.match(source, /from "@\/lib\/people\/permissions"/);
  assert.match(source, /getPersonAdminContext/);
  assert.match(source, /import \{ getOrgRole \}/);
  assert.match(source, /import \{ canEditNavItem \}/);
  assert.match(source, /canEditNavItem\(navConfig, "\/alumni", role, \["admin"\]\)/);
});

test("alumni detail derives canEdit from nav edit roles or ctx.canEditPerson(alumUserId)", () => {
  const source = readSource("src/app/[orgSlug]/alumni/[alumniId]/page.tsx");
  assert.match(source, /const canEdit = canEditPage \|\| ctx\.canEditPerson\(alumUserId\)/);
});

test("alumni detail preserves read-only billing gate via ctx", () => {
  const source = readSource("src/app/[orgSlug]/alumni/[alumniId]/page.tsx");
  assert.match(source, /const canModifyExisting = canEdit && !ctx\.isReadOnly/);
  assert.match(source, /const canDelete = canEditPage && !ctx\.isReadOnly/);
});

test("alumni detail headline derives from formatPersonHeadline with full precedence", () => {
  const source = readSource("src/app/[orgSlug]/alumni/[alumniId]/page.tsx");
  assert.match(source, /formatPersonHeadline\(\{[^}]*headline: alum\.headline/s);
  assert.match(source, /position_title: alum\.position_title/);
  assert.match(source, /job_title: alum\.job_title/);
});

// ─── Parents directory (parent detail intentionally unchanged) ────────

test("parents directory keeps nav edit roles for page-level actions", () => {
  const source = readSource("src/app/[orgSlug]/parents/page.tsx");
  assert.match(source, /import \{ getOrgContext, getOrgRole \}/);
  assert.match(source, /import \{ canEditNavItem \}/);
  assert.match(source, /canEditNavItem\(navConfig, "\/parents", role, \["admin"\]\)/);
});

test("parents directory derives canEdit from nav edit roles", () => {
  const source = readSource("src/app/[orgSlug]/parents/page.tsx");
  assert.match(source, /canEdit = canEditNavItem\(navConfig, "\/parents", role, \["admin"\]\)/);
});

// ─── Permission-helper invariants ─────────────────────────────────────

test("permissions helper takes viewerUserId from supabase.auth.getUser, never from URL/props", () => {
  const source = readSource("src/lib/people/permissions.ts");
  assert.match(source, /viewerUserId.{0,4}MUST come from.{0,4}supabase\.auth\.getUser\(\)/);
});

test("permissions helper documents the canEditPerson(null) invariant", () => {
  const source = readSource("src/lib/people/permissions.ts");
  assert.match(source, /canEditPerson\(null\).{0,8}returns.{0,4}isAdmin.{0,4}only/);
});

test("buildPersonAdminContext lives in a DB-free core module so unit tests don't pull next/navigation", () => {
  // The split is the reason `tests/unit/person-permissions.test.ts` can run
  // outside a Next.js request context; if this regresses, the unit tests
  // start failing with ERR_MODULE_NOT_FOUND for `next/navigation`.
  const corePath = path.join(process.cwd(), "src/lib/people/permissions-core.ts");
  assert.ok(fs.existsSync(corePath), "permissions-core.ts must exist as a DB-free split");
  const core = readSource("src/lib/people/permissions-core.ts");
  assert.doesNotMatch(core, /from "@\/lib\/supabase\/server"/);
  assert.doesNotMatch(core, /from "next\/navigation"/);
});
