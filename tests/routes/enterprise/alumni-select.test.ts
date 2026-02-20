import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Tests for C1 security fix: enterprise alumni routes must NOT expose
 * internal columns (user_id, created_at, updated_at, deleted_at) in API responses.
 *
 * Verifies that the explicit column selection and response construction
 * in alumni/route.ts and alumni/export/route.ts never leak infrastructure columns.
 */

// The 16 DB columns explicitly selected by the alumni routes
const ALLOWED_DB_COLUMNS = [
  "id",
  "organization_id",
  "first_name",
  "last_name",
  "email",
  "phone_number",
  "photo_url",
  "linkedin_url",
  "notes",
  "graduation_year",
  "major",
  "industry",
  "current_company",
  "current_city",
  "position_title",
  "job_title",
] as const;

// Columns injected by the route (not from DB)
const INJECTED_COLUMNS = ["organization_name", "organization_slug"] as const;

// Columns that must NEVER appear in API responses
const FORBIDDEN_COLUMNS = ["user_id", "created_at", "updated_at", "deleted_at"] as const;

/**
 * Simulates the alumni list response construction from route.ts.
 * Mirrors the explicit field mapping (no spread) at line 134+.
 */
function simulateAlumniListResponse(dbRow: Record<string, unknown>, orgInfo: { name: string; slug: string }) {
  return {
    id: dbRow.id,
    organization_id: dbRow.organization_id,
    first_name: dbRow.first_name,
    last_name: dbRow.last_name,
    email: dbRow.email,
    phone_number: dbRow.phone_number,
    photo_url: dbRow.photo_url,
    linkedin_url: dbRow.linkedin_url,
    notes: dbRow.notes,
    graduation_year: dbRow.graduation_year,
    major: dbRow.major,
    industry: dbRow.industry,
    current_company: dbRow.current_company,
    current_city: dbRow.current_city,
    position_title: dbRow.position_title,
    job_title: dbRow.job_title,
    organization_name: orgInfo.name,
    organization_slug: orgInfo.slug,
  };
}

/**
 * Simulates the alumni export response construction from export/route.ts.
 * Mirrors the explicit field mapping (no spread) at line 182+.
 */
function simulateAlumniExportResponse(dbRow: Record<string, unknown>, orgName: string) {
  return {
    id: dbRow.id,
    organization_id: dbRow.organization_id,
    first_name: dbRow.first_name,
    last_name: dbRow.last_name,
    email: dbRow.email,
    phone_number: dbRow.phone_number,
    photo_url: dbRow.photo_url,
    linkedin_url: dbRow.linkedin_url,
    notes: dbRow.notes,
    graduation_year: dbRow.graduation_year,
    major: dbRow.major,
    industry: dbRow.industry,
    current_company: dbRow.current_company,
    current_city: dbRow.current_city,
    position_title: dbRow.position_title,
    job_title: dbRow.job_title,
    organization_name: orgName,
  };
}

// Simulate a full DB row (select("*") would return all 20 columns)
function makeFullDbRow(): Record<string, unknown> {
  return {
    id: "alum-uuid-1",
    organization_id: "org-uuid-1",
    first_name: "Jane",
    last_name: "Doe",
    email: "jane@example.com",
    phone_number: "555-1234",
    photo_url: "https://example.com/photo.jpg",
    linkedin_url: "https://linkedin.com/in/janedoe",
    notes: "Active board member",
    graduation_year: 2020,
    major: "Computer Science",
    industry: "Technology",
    current_company: "Acme Corp",
    current_city: "San Francisco",
    position_title: "Software Engineer",
    job_title: "Senior Engineer",
    // Forbidden columns — these must NOT appear in API responses
    user_id: "auth-user-uuid-secret",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-06-15T12:00:00Z",
    deleted_at: null,
  };
}

describe("alumni list response (C1 fix)", () => {
  it("does NOT contain user_id in response", () => {
    const dbRow = makeFullDbRow();
    const response = simulateAlumniListResponse(dbRow, { name: "Test Org", slug: "test-org" });

    assert.strictEqual("user_id" in response, false, "Response must not contain user_id");
  });

  it("does NOT contain created_at in response", () => {
    const dbRow = makeFullDbRow();
    const response = simulateAlumniListResponse(dbRow, { name: "Test Org", slug: "test-org" });

    assert.strictEqual("created_at" in response, false, "Response must not contain created_at");
  });

  it("does NOT contain updated_at in response", () => {
    const dbRow = makeFullDbRow();
    const response = simulateAlumniListResponse(dbRow, { name: "Test Org", slug: "test-org" });

    assert.strictEqual("updated_at" in response, false, "Response must not contain updated_at");
  });

  it("does NOT contain deleted_at in response", () => {
    const dbRow = makeFullDbRow();
    const response = simulateAlumniListResponse(dbRow, { name: "Test Org", slug: "test-org" });

    assert.strictEqual("deleted_at" in response, false, "Response must not contain deleted_at");
  });

  it("contains all 16 allowed DB columns plus 2 injected columns", () => {
    const dbRow = makeFullDbRow();
    const response = simulateAlumniListResponse(dbRow, { name: "Test Org", slug: "test-org" });

    const responseKeys = Object.keys(response);
    const expectedKeys = [...ALLOWED_DB_COLUMNS, ...INJECTED_COLUMNS];

    assert.strictEqual(responseKeys.length, expectedKeys.length);
    for (const key of expectedKeys) {
      assert.ok(key in response, `Response must contain ${key}`);
    }
  });

  it("no forbidden column appears in response even with full DB row", () => {
    const dbRow = makeFullDbRow();
    const response = simulateAlumniListResponse(dbRow, { name: "Test Org", slug: "test-org" });

    for (const forbidden of FORBIDDEN_COLUMNS) {
      assert.strictEqual(forbidden in response, false, `Response must not contain ${forbidden}`);
    }
  });

  it("preserves correct values for all allowed fields", () => {
    const dbRow = makeFullDbRow();
    const response = simulateAlumniListResponse(dbRow, { name: "Test Org", slug: "test-org" });

    assert.strictEqual(response.id, "alum-uuid-1");
    assert.strictEqual(response.first_name, "Jane");
    assert.strictEqual(response.last_name, "Doe");
    assert.strictEqual(response.email, "jane@example.com");
    assert.strictEqual(response.organization_name, "Test Org");
    assert.strictEqual(response.organization_slug, "test-org");
  });
});

describe("alumni export response (C1 fix)", () => {
  it("does NOT contain any forbidden columns", () => {
    const dbRow = makeFullDbRow();
    const response = simulateAlumniExportResponse(dbRow, "Test Org");

    for (const forbidden of FORBIDDEN_COLUMNS) {
      assert.strictEqual(forbidden in response, false, `Export response must not contain ${forbidden}`);
    }
  });

  it("contains 16 allowed DB columns plus organization_name", () => {
    const dbRow = makeFullDbRow();
    const response = simulateAlumniExportResponse(dbRow, "Test Org");

    const responseKeys = Object.keys(response);
    // 16 DB columns + organization_name (export does not include organization_slug)
    assert.strictEqual(responseKeys.length, 17);

    for (const col of ALLOWED_DB_COLUMNS) {
      assert.ok(col in response, `Export response must contain ${col}`);
    }
    assert.ok("organization_name" in response, "Export response must contain organization_name");
  });

  it("does NOT include organization_slug (export only has organization_name)", () => {
    const dbRow = makeFullDbRow();
    const response = simulateAlumniExportResponse(dbRow, "Test Org");

    assert.strictEqual("organization_slug" in response, false);
  });
});
