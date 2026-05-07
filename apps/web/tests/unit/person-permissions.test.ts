import { strict as assert } from "assert";
import { test } from "node:test";
import { buildPersonAdminContext } from "@/lib/people/permissions-core";

const ADMIN = "admin-user";
const VIEWER = "viewer-user";
const OTHER = "other-user";
const ALUM = "alumni-user";
const PARENT = "parent-user";

const roleRows = [
  { user_id: ADMIN, role: "admin" },
  { user_id: VIEWER, role: "active_member" },
  { user_id: OTHER, role: "active_member" },
  { user_id: ALUM, role: "alumni" },
  { user_id: PARENT, role: "parent" },
];

test("admin viewer can edit any target user", () => {
  const ctx = buildPersonAdminContext({
    viewerUserId: ADMIN,
    isAdmin: true,
    isReadOnly: false,
    roleRows,
  });
  assert.equal(ctx.canEditPerson(ADMIN), true);
  assert.equal(ctx.canEditPerson(VIEWER), true);
  assert.equal(ctx.canEditPerson(OTHER), true);
  assert.equal(ctx.canEditPerson(ALUM), true);
});

test("non-admin viewer can self-edit but not edit others", () => {
  const ctx = buildPersonAdminContext({
    viewerUserId: VIEWER,
    isAdmin: false,
    isReadOnly: false,
    roleRows,
  });
  assert.equal(ctx.canEditPerson(VIEWER), true);
  assert.equal(ctx.canEditPerson(OTHER), false);
  assert.equal(ctx.canEditPerson(ALUM), false);
  assert.equal(ctx.canEditPerson(ADMIN), false);
});

test("alumni-on-other denied; alumni-on-self allowed", () => {
  const ctx = buildPersonAdminContext({
    viewerUserId: ALUM,
    isAdmin: false,
    isReadOnly: false,
    roleRows,
  });
  assert.equal(ctx.canEditPerson(ALUM), true);
  assert.equal(ctx.canEditPerson(OTHER), false);
});

test("parent-on-self allowed; parent-on-other denied", () => {
  const ctx = buildPersonAdminContext({
    viewerUserId: PARENT,
    isAdmin: false,
    isReadOnly: false,
    roleRows,
  });
  assert.equal(ctx.canEditPerson(PARENT), true);
  assert.equal(ctx.canEditPerson(VIEWER), false);
});

test("anonymous viewer (null viewerUserId) cannot edit anyone", () => {
  const ctx = buildPersonAdminContext({
    viewerUserId: null,
    isAdmin: false,
    isReadOnly: false,
    roleRows,
  });
  assert.equal(ctx.canEditPerson(VIEWER), false);
  assert.equal(ctx.canEditPerson(ADMIN), false);
});

test("canEditPerson(null) returns isAdmin — null does NOT match null", () => {
  const adminCtx = buildPersonAdminContext({
    viewerUserId: ADMIN,
    isAdmin: true,
    isReadOnly: false,
    roleRows,
  });
  assert.equal(adminCtx.canEditPerson(null), true);
  assert.equal(adminCtx.canEditPerson(undefined), true);

  // Non-admin self-viewer must NOT get edit rights on a null target row.
  const selfCtx = buildPersonAdminContext({
    viewerUserId: VIEWER,
    isAdmin: false,
    isReadOnly: false,
    roleRows,
  });
  assert.equal(selfCtx.canEditPerson(null), false);
  assert.equal(selfCtx.canEditPerson(undefined), false);
});

test("canEditPerson with viewerUserId null + target set returns isAdmin only", () => {
  const ctx = buildPersonAdminContext({
    viewerUserId: null,
    isAdmin: false,
    isReadOnly: false,
    roleRows,
  });
  assert.equal(ctx.canEditPerson(VIEWER), false);

  const adminAnonCtx = buildPersonAdminContext({
    viewerUserId: null,
    isAdmin: true,
    isReadOnly: false,
    roleRows,
  });
  // Defensive: even if some upstream builder claimed isAdmin without a
  // viewerUserId, the helper does not crash; admin truth wins.
  assert.equal(adminAnonCtx.canEditPerson(VIEWER), true);
});

test("isReadOnly flag is surfaced on the context", () => {
  const ro = buildPersonAdminContext({
    viewerUserId: ADMIN,
    isAdmin: true,
    isReadOnly: true,
    roleRows,
  });
  assert.equal(ro.isReadOnly, true);

  const live = buildPersonAdminContext({
    viewerUserId: ADMIN,
    isAdmin: true,
    isReadOnly: false,
    roleRows,
  });
  assert.equal(live.isReadOnly, false);
});

test("adminUserIds set contains exactly the admin role rows", () => {
  const ctx = buildPersonAdminContext({
    viewerUserId: VIEWER,
    isAdmin: false,
    isReadOnly: false,
    roleRows,
  });
  assert.equal(ctx.adminUserIds.has(ADMIN), true);
  assert.equal(ctx.adminUserIds.has(VIEWER), false);
  assert.equal(ctx.adminUserIds.has(ALUM), false);
});

test("orgRoleLabelFor maps the four canonical roles + null cases", () => {
  const ctx = buildPersonAdminContext({
    viewerUserId: ADMIN,
    isAdmin: true,
    isReadOnly: false,
    roleRows,
  });
  assert.equal(ctx.orgRoleLabelFor(ADMIN), "Admin");
  assert.equal(ctx.orgRoleLabelFor(VIEWER), "Member");
  assert.equal(ctx.orgRoleLabelFor(ALUM), "Alumni");
  assert.equal(ctx.orgRoleLabelFor(PARENT), "Parent");
  assert.equal(ctx.orgRoleLabelFor(null), null);
  assert.equal(ctx.orgRoleLabelFor(undefined), null);
  assert.equal(ctx.orgRoleLabelFor("unknown-user"), null);
});

test("orgRoleLabelFor ignores rows missing user_id or role", () => {
  const ctx = buildPersonAdminContext({
    viewerUserId: ADMIN,
    isAdmin: true,
    isReadOnly: false,
    roleRows: [
      { user_id: null, role: "admin" },
      { user_id: VIEWER, role: null },
      { user_id: ADMIN, role: "admin" },
    ],
  });
  assert.equal(ctx.orgRoleLabelFor(VIEWER), null);
  assert.equal(ctx.orgRoleLabelFor(ADMIN), "Admin");
  assert.equal(ctx.adminUserIds.has(ADMIN), true);
  assert.equal(ctx.adminUserIds.size, 1);
});

test("forged viewerUserId without admin truth cannot escalate", () => {
  // Simulates a non-admin caller passing another user's id as viewerUserId.
  // canEditPerson must rely on the orchestrator-supplied isAdmin flag,
  // and self-edit only works when viewerUserId actually matches.
  const ctx = buildPersonAdminContext({
    viewerUserId: "attacker-id",
    isAdmin: false,
    isReadOnly: false,
    roleRows,
  });
  assert.equal(ctx.canEditPerson(VIEWER), false);
  assert.equal(ctx.canEditPerson(OTHER), false);
  // Self-edit only when target matches the (forged) viewer id — but the
  // viewer cannot escalate to admin; the rest of the rows stay protected.
  assert.equal(ctx.canEditPerson("attacker-id"), true);
});
