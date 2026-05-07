import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeRole, roleFlags, type OrgRole } from "@/lib/auth/role-utils";

describe("normalizeRole — parent is a distinct OrgRole", () => {
  it('normalizeRole("parent") returns "parent"', () => {
    assert.equal(normalizeRole("parent"), "parent");
  });

  it('normalizeRole("parent") does NOT return "alumni"', () => {
    assert.notEqual(normalizeRole("parent"), "alumni");
  });

  it('normalizeRole("alumni") still returns "alumni"', () => {
    assert.equal(normalizeRole("alumni"), "alumni");
  });

  it("returns null for unknown/future role values", () => {
    // Safety: unknown raw roles return null rather than crashing
    assert.equal(normalizeRole("unknown_future_role" as never), null);
  });
});

describe("roleFlags — isParent flag", () => {
  it('roleFlags("parent") has isParent: true', () => {
    const flags = roleFlags("parent" as OrgRole);
    assert.equal(flags.isParent, true);
  });

  it('roleFlags("parent") has isAlumni: false', () => {
    const flags = roleFlags("parent" as OrgRole);
    assert.equal(flags.isAlumni, false);
  });

  it('roleFlags("parent") has isAdmin: false', () => {
    const flags = roleFlags("parent" as OrgRole);
    assert.equal(flags.isAdmin, false);
  });

  it('roleFlags("parent") has isActiveMember: false', () => {
    const flags = roleFlags("parent" as OrgRole);
    assert.equal(flags.isActiveMember, false);
  });

  it('roleFlags("alumni") has isParent: false', () => {
    const flags = roleFlags("alumni" as OrgRole);
    assert.equal(flags.isParent, false);
  });

  it("roleFlags(null) has isParent: false", () => {
    const flags = roleFlags(null);
    assert.equal(flags.isParent, false);
  });
});
