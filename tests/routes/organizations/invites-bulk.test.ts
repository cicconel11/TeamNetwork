import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { orgBulkInviteSchema } from "../../../src/lib/schemas/invite.ts";

describe("orgBulkInviteSchema validation", () => {
  it("accepts valid bulk invite payload", () => {
    const result = orgBulkInviteSchema.safeParse({
      emails: ["alice@example.com", "bob@example.com"],
      role: "active_member",
    });

    assert.ok(result.success);
    assert.equal(result.data.emails.length, 2);
    assert.equal(result.data.role, "active_member");
  });

  it("accepts all valid roles", () => {
    for (const role of ["admin", "active_member", "alumni", "parent"]) {
      const result = orgBulkInviteSchema.safeParse({
        emails: ["test@example.com"],
        role,
      });
      assert.ok(result.success, `Expected role "${role}" to be valid`);
    }
  });

  it("accepts optional expiresAt and requireApproval", () => {
    const result = orgBulkInviteSchema.safeParse({
      emails: ["test@example.com"],
      role: "active_member",
      expiresAt: "2026-12-31T23:59:59Z",
      requireApproval: true,
    });

    assert.ok(result.success);
    assert.equal(result.data.expiresAt, "2026-12-31T23:59:59Z");
    assert.equal(result.data.requireApproval, true);
  });

  it("rejects empty emails array", () => {
    const result = orgBulkInviteSchema.safeParse({
      emails: [],
      role: "active_member",
    });

    assert.ok(!result.success);
    assert.ok(result.error.issues.some((i) => i.message.includes("1")));
  });

  it("rejects more than 100 emails", () => {
    const emails = Array.from({ length: 101 }, (_, i) => `user${i}@example.com`);
    const result = orgBulkInviteSchema.safeParse({
      emails,
      role: "active_member",
    });

    assert.ok(!result.success);
    assert.ok(result.error.issues.some((i) => i.message.includes("100")));
  });

  it("rejects invalid email addresses", () => {
    const result = orgBulkInviteSchema.safeParse({
      emails: ["not-an-email", "also-invalid"],
      role: "active_member",
    });

    assert.ok(!result.success);
  });

  it("rejects invalid role", () => {
    const result = orgBulkInviteSchema.safeParse({
      emails: ["test@example.com"],
      role: "superadmin",
    });

    assert.ok(!result.success);
  });

  it("rejects missing role", () => {
    const result = orgBulkInviteSchema.safeParse({
      emails: ["test@example.com"],
    });

    assert.ok(!result.success);
  });

  it("rejects invalid expiresAt format", () => {
    const result = orgBulkInviteSchema.safeParse({
      emails: ["test@example.com"],
      role: "active_member",
      expiresAt: "March 27, 2026",
    });

    assert.ok(!result.success);
  });

  it("accepts exactly 100 emails", () => {
    const emails = Array.from({ length: 100 }, (_, i) => `user${i}@example.com`);
    const result = orgBulkInviteSchema.safeParse({
      emails,
      role: "alumni",
    });

    assert.ok(result.success);
    assert.equal(result.data.emails.length, 100);
  });

  it("dedupes repeated emails and normalizes casing", () => {
    const result = orgBulkInviteSchema.safeParse({
      emails: ["ALICE@example.com", "alice@example.com", "Bob@example.com"],
      role: "active_member",
    });

    assert.ok(result.success);
    assert.deepEqual(result.data.emails, ["alice@example.com", "bob@example.com"]);
  });

  it("accepts nullable expiresAt and requireApproval", () => {
    const result = orgBulkInviteSchema.safeParse({
      emails: ["test@example.com"],
      role: "active_member",
      expiresAt: null,
      requireApproval: null,
    });

    assert.ok(result.success);
    assert.equal(result.data.expiresAt, null);
    assert.equal(result.data.requireApproval, null);
  });
});
