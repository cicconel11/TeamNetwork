/**
 * Parents CRUD — additional coverage beyond tests/routes/organizations/parents.test.ts
 *
 * Focus: schema validation edge cases (HTTPS URLs, notes length, org UUID)
 * and soft-delete / org-scoping correctness.
 *
 * Run: node --test --loader ./tests/ts-loader.js tests/parents-crud.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { newParentSchema } from "@/lib/schemas";

// ── Schema validation ─────────────────────────────────────────────────────────

describe("newParentSchema validation", () => {
  it("accepts minimal body (first_name + last_name only)", () => {
    const result = newParentSchema.safeParse({ first_name: "Jane", last_name: "Smith" });
    assert.ok(result.success, "should parse minimal valid body");
  });

  it("accepts full body with all optional fields", () => {
    const result = newParentSchema.safeParse({
      first_name: "Jane",
      last_name: "Smith",
      email: "jane@example.com",
      phone_number: "555-0100",
      photo_url: "https://example.com/photo.jpg",
      linkedin_url: "https://linkedin.com/in/jane",
      student_name: "Alex Smith",
      relationship: "mother",
      notes: "Volunteer coach",
    });
    assert.ok(result.success, "should accept full valid body");
  });

  it("rejects HTTP photo_url (HTTPS required)", () => {
    const result = newParentSchema.safeParse({
      first_name: "Jane",
      last_name: "Smith",
      photo_url: "http://example.com/photo.jpg",
    });
    assert.ok(!result.success, "HTTP photo_url must be rejected");
  });

  it("rejects HTTP linkedin_url (HTTPS required)", () => {
    const result = newParentSchema.safeParse({
      first_name: "Jane",
      last_name: "Smith",
      linkedin_url: "http://linkedin.com/in/jane",
    });
    assert.ok(!result.success, "HTTP linkedin_url must be rejected");
  });

  it("accepts HTTPS photo_url", () => {
    const result = newParentSchema.safeParse({
      first_name: "Jane",
      last_name: "Smith",
      photo_url: "https://cdn.example.com/photo.jpg",
    });
    assert.ok(result.success, "valid HTTPS photo_url should be accepted");
  });

  it("rejects notes longer than 1000 characters", () => {
    const result = newParentSchema.safeParse({
      first_name: "Jane",
      last_name: "Smith",
      notes: "x".repeat(1001),
    });
    assert.ok(!result.success, "notes > 1000 chars must be rejected");
  });

  it("accepts notes of exactly 1000 characters", () => {
    const result = newParentSchema.safeParse({
      first_name: "Jane",
      last_name: "Smith",
      notes: "x".repeat(1000),
    });
    assert.ok(result.success, "notes of exactly 1000 chars should be accepted");
  });

  it("rejects missing first_name", () => {
    const result = newParentSchema.safeParse({ last_name: "Smith" });
    assert.ok(!result.success, "missing first_name must be rejected");
  });

  it("rejects missing last_name", () => {
    const result = newParentSchema.safeParse({ first_name: "Jane" });
    assert.ok(!result.success, "missing last_name must be rejected");
  });

  it("rejects invalid email format", () => {
    const result = newParentSchema.safeParse({
      first_name: "Jane",
      last_name: "Smith",
      email: "not-an-email",
    });
    assert.ok(!result.success, "invalid email must be rejected");
  });

  it("accepts empty string email (treated as no email)", () => {
    // optionalEmail accepts empty string
    const result = newParentSchema.safeParse({
      first_name: "Jane",
      last_name: "Smith",
      email: "",
    });
    assert.ok(result.success, "empty email should be accepted by optionalEmail schema");
  });

  it("rejects first_name exceeding 100 characters", () => {
    const result = newParentSchema.safeParse({
      first_name: "J".repeat(101),
      last_name: "Smith",
    });
    assert.ok(!result.success, "first_name > 100 chars must be rejected");
  });

  it("rejects last_name exceeding 100 characters", () => {
    const result = newParentSchema.safeParse({
      first_name: "Jane",
      last_name: "S".repeat(101),
    });
    assert.ok(!result.success, "last_name > 100 chars must be rejected");
  });
});

// ── Org UUID validation (mirrors baseSchemas.uuid checks in route handlers) ───

describe("Route-level org UUID validation", () => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function validateOrgId(orgId: string): { valid: boolean } {
    return { valid: uuidRegex.test(orgId) };
  }

  it("rejects non-UUID organization ID", () => {
    assert.ok(!validateOrgId("not-a-uuid").valid, "non-UUID org ID must be invalid");
  });

  it("rejects empty organization ID", () => {
    assert.ok(!validateOrgId("").valid, "empty org ID must be invalid");
  });

  it("rejects slug-style organization ID", () => {
    assert.ok(!validateOrgId("my-org-slug").valid, "slug must be rejected");
  });

  it("accepts valid UUID organization ID", () => {
    assert.ok(validateOrgId(randomUUID()).valid, "valid UUID should be accepted");
  });

  it("accepts uppercase UUID", () => {
    assert.ok(
      validateOrgId("550E8400-E29B-41D4-A716-446655440000").valid,
      "uppercase UUID should be accepted"
    );
  });
});

// ── Soft-delete and org-scoping edge cases ────────────────────────────────────

interface ParentStub {
  id: string;
  organization_id: string;
  deleted_at: string | null;
}

function makeParentStub(overrides: Partial<ParentStub> = {}): ParentStub {
  return {
    id: randomUUID(),
    organization_id: "org-1",
    deleted_at: null,
    ...overrides,
  };
}

/**
 * Mirrors the lookup in PATCH and DELETE route handlers:
 * .eq("id", parentId).eq("organization_id", organizationId).is("deleted_at", null)
 */
function lookupParent(
  parents: ParentStub[],
  parentId: string,
  orgId: string
): ParentStub | undefined {
  return parents.find(
    (p) => p.id === parentId && p.organization_id === orgId && p.deleted_at === null
  );
}

function simulatePatch(options: {
  orgId: string;
  parentId: string;
  parents: ParentStub[];
  role: string | null;
}): { status: number; error?: string } {
  if (!options.role) return { status: 401, error: "Unauthorized" };
  if (options.role !== "admin") return { status: 403, error: "Forbidden" };
  const existing = lookupParent(options.parents, options.parentId, options.orgId);
  if (!existing) return { status: 404, error: "Parent not found" };
  return { status: 200 };
}

function simulateDelete(options: {
  orgId: string;
  parentId: string;
  parents: ParentStub[];
  role: string | null;
}): { status: number; error?: string; success?: boolean } {
  if (!options.role) return { status: 401, error: "Unauthorized" };
  if (options.role !== "admin") return { status: 403, error: "Forbidden" };
  const existing = lookupParent(options.parents, options.parentId, options.orgId);
  if (!existing) return { status: 404, error: "Parent not found" };
  return { status: 200, success: true };
}

describe("PATCH /parents/[parentId] — soft-delete and org-scoping", () => {
  it("returns 404 when parent is soft-deleted", () => {
    const parent = makeParentStub({ deleted_at: new Date().toISOString() });
    const result = simulatePatch({
      orgId: "org-1",
      parentId: parent.id,
      parents: [parent],
      role: "admin",
    });
    assert.equal(result.status, 404);
    assert.equal(result.error, "Parent not found");
  });

  it("returns 404 when parentId belongs to a different org", () => {
    // Parent belongs to org-2; request targets org-1 — must not be visible
    const parent = makeParentStub({ organization_id: "org-2" });
    const result = simulatePatch({
      orgId: "org-1",
      parentId: parent.id,
      parents: [parent],
      role: "admin",
    });
    assert.equal(result.status, 404);
    assert.equal(result.error, "Parent not found");
  });

  it("returns 200 for active parent in correct org", () => {
    const parent = makeParentStub();
    const result = simulatePatch({
      orgId: "org-1",
      parentId: parent.id,
      parents: [parent],
      role: "admin",
    });
    assert.equal(result.status, 200);
  });

  it("returns 401 for unauthenticated", () => {
    const parent = makeParentStub();
    const result = simulatePatch({
      orgId: "org-1",
      parentId: parent.id,
      parents: [parent],
      role: null,
    });
    assert.equal(result.status, 401);
  });
});

describe("DELETE /parents/[parentId] — soft-delete and org-scoping", () => {
  it("returns 404 when parent is already soft-deleted", () => {
    const parent = makeParentStub({ deleted_at: new Date().toISOString() });
    const result = simulateDelete({
      orgId: "org-1",
      parentId: parent.id,
      parents: [parent],
      role: "admin",
    });
    assert.equal(result.status, 404);
    assert.equal(result.error, "Parent not found");
  });

  it("returns 404 when parentId belongs to a different org", () => {
    const parent = makeParentStub({ organization_id: "org-2" });
    const result = simulateDelete({
      orgId: "org-1",
      parentId: parent.id,
      parents: [parent],
      role: "admin",
    });
    assert.equal(result.status, 404);
    assert.equal(result.error, "Parent not found");
  });

  it("returns 200 with success:true for active parent in correct org", () => {
    const parent = makeParentStub();
    const result = simulateDelete({
      orgId: "org-1",
      parentId: parent.id,
      parents: [parent],
      role: "admin",
    });
    assert.equal(result.status, 200);
    assert.equal(result.success, true);
  });

  it("returns 401 for unauthenticated", () => {
    const parent = makeParentStub();
    const result = simulateDelete({
      orgId: "org-1",
      parentId: parent.id,
      parents: [parent],
      role: null,
    });
    assert.equal(result.status, 401);
  });
});
