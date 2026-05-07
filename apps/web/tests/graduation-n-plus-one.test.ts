import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import {
  batchGetOrganizations,
  batchGetOrgAdminEmails,
  batchCheckAlumniCapacity,
} from "../src/lib/graduation/queries.ts";

// ---------------------------------------------------------------------------
// Task 5: batchGetOrganizations
// ---------------------------------------------------------------------------

describe("batchGetOrganizations", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("returns Map<string, OrgWithSlug> for all requested IDs", async () => {
    stub.seed("organizations", [
      { id: "org1", name: "Org One", slug: "org-one" },
      { id: "org2", name: "Org Two", slug: "org-two" },
    ]);

    const result = await batchGetOrganizations(stub as never, ["org1", "org2"]);

    assert.ok(result instanceof Map, "Should return a Map");
    assert.strictEqual(result.size, 2, "Should have 2 entries");

    const org1 = result.get("org1");
    assert.ok(org1, "org1 should be in the map");
    assert.strictEqual(org1.id, "org1");
    assert.strictEqual(org1.name, "Org One");
    assert.strictEqual(org1.slug, "org-one");

    const org2 = result.get("org2");
    assert.ok(org2, "org2 should be in the map");
    assert.strictEqual(org2.slug, "org-two");
  });

  it("missing org IDs are absent from the map", async () => {
    stub.seed("organizations", [
      { id: "org1", name: "Org One", slug: "org-one" },
    ]);

    const result = await batchGetOrganizations(stub as never, ["org1", "org-missing"]);

    assert.strictEqual(result.size, 1, "Only found org should be in map");
    assert.ok(result.has("org1"), "org1 should be present");
    assert.ok(!result.has("org-missing"), "org-missing should be absent");
  });

  it("empty orgIds returns empty map without DB call", async () => {
    // Seed data to verify we don't touch the DB
    stub.seed("organizations", [
      { id: "org1", name: "Org One", slug: "org-one" },
    ]);

    const result = await batchGetOrganizations(stub as never, []);

    assert.ok(result instanceof Map, "Should return a Map");
    assert.strictEqual(result.size, 0, "Empty input → empty map");
  });

  it("throws on Supabase query error", async () => {
    stub.simulateError("organizations", { message: "connection timeout" });

    await assert.rejects(
      () => batchGetOrganizations(stub as never, ["org1"]),
      (err: Error) => {
        assert.ok(err.message.includes("batch-fetch organizations"), "Error should mention batch-fetch organizations");
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// Task 6: batchGetOrgAdminEmails
// ---------------------------------------------------------------------------

describe("batchGetOrgAdminEmails", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("returns Map<string, string[]> covering multiple orgs", async () => {
    stub.seed("user_organization_roles", [
      { user_id: "u1", organization_id: "org1", role: "admin", status: "active" },
      { user_id: "u2", organization_id: "org1", role: "admin", status: "active" },
      { user_id: "u3", organization_id: "org2", role: "admin", status: "active" },
    ]);
    stub.seed("users", [
      { id: "u1", email: "admin1@example.com" },
      { id: "u2", email: "admin2@example.com" },
      { id: "u3", email: "admin3@example.com" },
    ]);

    const result = await batchGetOrgAdminEmails(stub as never, ["org1", "org2"]);

    assert.ok(result instanceof Map, "Should return a Map");
    assert.strictEqual(result.size, 2, "Should have entries for 2 orgs");

    const org1Emails = result.get("org1");
    assert.ok(Array.isArray(org1Emails), "org1 emails should be an array");
    assert.strictEqual(org1Emails?.length, 2, "org1 should have 2 admins");
    assert.ok(org1Emails?.includes("admin1@example.com"), "org1 should include admin1");
    assert.ok(org1Emails?.includes("admin2@example.com"), "org1 should include admin2");

    const org2Emails = result.get("org2");
    assert.ok(Array.isArray(org2Emails), "org2 emails should be an array");
    assert.strictEqual(org2Emails?.length, 1, "org2 should have 1 admin");
    assert.ok(org2Emails?.includes("admin3@example.com"), "org2 should include admin3");
  });

  it("org with no admin roles maps to empty array", async () => {
    // No roles seeded for org1 — it has no admins
    stub.seed("user_organization_roles", [
      { user_id: "u1", organization_id: "org2", role: "admin", status: "active" },
    ]);
    stub.seed("users", [
      { id: "u1", email: "admin1@example.com" },
    ]);

    const result = await batchGetOrgAdminEmails(stub as never, ["org1", "org2"]);

    assert.strictEqual(result.size, 2, "Both orgs should be in map");
    const org1Emails = result.get("org1");
    assert.ok(Array.isArray(org1Emails), "org1 emails should be an array");
    assert.strictEqual(org1Emails?.length, 0, "org1 should have empty email list");
  });

  it("admin with null email is omitted", async () => {
    stub.seed("user_organization_roles", [
      { user_id: "u1", organization_id: "org1", role: "admin", status: "active" },
      { user_id: "u2", organization_id: "org1", role: "admin", status: "active" },
    ]);
    stub.seed("users", [
      { id: "u1", email: null },
      { id: "u2", email: "admin2@example.com" },
    ]);

    const result = await batchGetOrgAdminEmails(stub as never, ["org1"]);

    const org1Emails = result.get("org1");
    assert.strictEqual(org1Emails?.length, 1, "Null email should be omitted");
    assert.ok(org1Emails?.includes("admin2@example.com"), "Valid email should be included");
  });

  it("empty orgIds returns empty map", async () => {
    const result = await batchGetOrgAdminEmails(stub as never, []);

    assert.ok(result instanceof Map, "Should return a Map");
    assert.strictEqual(result.size, 0, "Empty input → empty map");
  });

  it("throws on roles query error", async () => {
    stub.simulateError("user_organization_roles", { message: "query failed" });

    await assert.rejects(
      () => batchGetOrgAdminEmails(stub as never, ["org1"]),
      (err: Error) => {
        assert.ok(err.message.includes("batch-fetch admin emails"), "Error should mention batch-fetch admin emails");
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// Task 7: batchCheckAlumniCapacity
// ---------------------------------------------------------------------------

describe("batchCheckAlumniCapacity", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("returns Map<string, CapacityResult> for all orgs", async () => {
    stub.seed("organization_subscriptions", [
      { organization_id: "org1", alumni_bucket: "0-250" },
      { organization_id: "org2", alumni_bucket: "0-250" },
    ]);
    stub.seed("alumni", [
      { organization_id: "org1", deleted_at: null },
      { organization_id: "org1", deleted_at: null },
    ]);
    stub.seed("user_organization_roles", [
      { organization_id: "org1", role: "alumni", status: "active" },
      { organization_id: "org1", role: "alumni", status: "active" },
    ]);

    const result = await batchCheckAlumniCapacity(stub as never, ["org1", "org2"]);

    assert.ok(result instanceof Map, "Should return a Map");
    assert.strictEqual(result.size, 2, "Should have entries for both orgs");

    const org1 = result.get("org1");
    assert.ok(org1, "org1 should be in the map");
    assert.strictEqual(org1.hasCapacity, true, "org1 should have capacity (2 < 250)");
    assert.strictEqual(org1.currentCount, 2, "org1 should have currentCount 2");
    assert.strictEqual(org1.limit, 250, "org1 limit should be 250");

    const org2 = result.get("org2");
    assert.ok(org2, "org2 should be in the map");
    assert.strictEqual(org2.hasCapacity, true, "org2 should have capacity (0 < 250)");
    assert.strictEqual(org2.currentCount, 0, "org2 should have currentCount 0");
  });

  it("alumni_bucket 'none' → hasCapacity: false", async () => {
    stub.seed("organization_subscriptions", [
      { organization_id: "org1", alumni_bucket: "none" },
    ]);
    // No alumni seeded — count is 0, but limit is also 0

    const result = await batchCheckAlumniCapacity(stub as never, ["org1"]);

    const org1 = result.get("org1");
    assert.ok(org1, "org1 should be in the map");
    assert.strictEqual(org1.hasCapacity, false, "bucket 'none' means no capacity");
    assert.strictEqual(org1.limit, 0, "limit should be 0 for 'none' bucket");
  });

  it("unlimited bucket → hasCapacity: true, limit: null", async () => {
    stub.seed("organization_subscriptions", [
      { organization_id: "org1", alumni_bucket: "5000+" },
    ]);
    // Seed many alumni — should still have capacity
    for (let i = 0; i < 10; i++) {
      stub.seed("alumni", [{ organization_id: "org1", deleted_at: null }]);
    }

    const result = await batchCheckAlumniCapacity(stub as never, ["org1"]);

    const org1 = result.get("org1");
    assert.ok(org1, "org1 should be in the map");
    assert.strictEqual(org1.hasCapacity, true, "unlimited bucket should always have capacity");
    assert.strictEqual(org1.limit, null, "limit should be null for unlimited bucket");
  });

  it("cross-references alumni table count vs roles table count", async () => {
    stub.seed("organization_subscriptions", [
      { organization_id: "org1", alumni_bucket: "0-250" },
    ]);
    // Alumni table: 3 records
    stub.seed("alumni", [
      { organization_id: "org1", deleted_at: null },
      { organization_id: "org1", deleted_at: null },
      { organization_id: "org1", deleted_at: null },
    ]);
    // Roles table: 2 records (mismatch — will trigger warning)
    stub.seed("user_organization_roles", [
      { organization_id: "org1", role: "alumni", status: "active" },
      { organization_id: "org1", role: "alumni", status: "active" },
    ]);

    // This should succeed but log a warning; the alumni table count is authoritative
    const result = await batchCheckAlumniCapacity(stub as never, ["org1"]);

    const org1 = result.get("org1");
    assert.ok(org1, "org1 should be in the map");
    // alumni table is authoritative: 3 records
    assert.strictEqual(org1.currentCount, 3, "currentCount should use alumni table as source of truth");
    assert.strictEqual(org1.hasCapacity, true, "3 < 250, so has capacity");
  });

  it("empty orgIds returns empty map", async () => {
    const result = await batchCheckAlumniCapacity(stub as never, []);

    assert.ok(result instanceof Map, "Should return a Map");
    assert.strictEqual(result.size, 0, "Empty input → empty map");
  });

  it("org with no subscription defaults to 'none' bucket → hasCapacity: false", async () => {
    // No subscription seeded for org1
    const result = await batchCheckAlumniCapacity(stub as never, ["org1"]);

    const org1 = result.get("org1");
    assert.ok(org1, "org1 should still be in the map");
    assert.strictEqual(org1.hasCapacity, false, "No subscription → no capacity");
    assert.strictEqual(org1.limit, 0, "No subscription → limit 0");
  });
});
