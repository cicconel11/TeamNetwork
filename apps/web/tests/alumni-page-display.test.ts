import assert from "node:assert/strict";
import test, { describe, beforeEach } from "node:test";
import { createSupabaseStub } from "./utils/supabaseStub.ts";

const ORG_ID = "org-001";

function makeAlumni(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: ORG_ID,
    first_name: "Test",
    last_name: "Alumni",
    photo_url: null,
    position_title: null,
    job_title: null,
    current_company: null,
    graduation_year: 2020,
    industry: null,
    current_city: null,
    deleted_at: null,
    ...overrides,
  };
}

describe("alumni page display — direct query vs role-based filtering", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  test("BUG REPRO: alumni with no user_organization_roles entries are returned by direct query", async () => {
    // Seed 10 alumni records — none have user_organization_roles entries
    const alumni = Array.from({ length: 10 }, (_, i) =>
      makeAlumni({
        id: `alumni-${i + 1}`,
        first_name: `First${i + 1}`,
        last_name: `Last${i + 1}`,
        graduation_year: 2015 + i,
      })
    );
    stub.seed("alumni", alumni);

    // Seed empty user_organization_roles — no alumni-role users exist
    // (This is the real-world scenario: alumni added via "Add Alumni" form)

    // FIXED query: query alumni table directly (no role filtering)
    const { data: directAlumni } = await stub
      .from("alumni")
      .select(
        "id, first_name, last_name, photo_url, position_title, job_title, current_company, graduation_year, industry, current_city"
      )
      .eq("organization_id", ORG_ID)
      .is("deleted_at", null);

    assert.equal(directAlumni!.length, 10, "Direct query should return all 10 alumni");
  });

  test("BUG REPRO: old role-based approach returns 0 alumni when no roles exist", async () => {
    // Seed 10 alumni records
    const alumni = Array.from({ length: 10 }, (_, i) =>
      makeAlumni({
        id: `alumni-${i + 1}`,
        first_name: `First${i + 1}`,
        last_name: `Last${i + 1}`,
      })
    );
    stub.seed("alumni", alumni);

    // Simulate the OLD buggy approach:
    // Step 1: Query user_organization_roles for alumni/admin roles
    const { data: alumniRoles } = await stub
      .from("user_organization_roles")
      .select("user_id, role")
      .eq("organization_id", ORG_ID)
      .in("role", ["alumni", "admin"])
      .eq("status", "active");

    const alumniUserIds = alumniRoles?.map((r) => r.user_id as string) || [];

    // Step 2: Filter alumni by user_ids — this was the bug
    // When no roles exist, alumniUserIds is empty → query uses "__no_match__"
    let query = stub
      .from("alumni")
      .select("id, first_name, last_name")
      .eq("organization_id", ORG_ID)
      .is("deleted_at", null);

    if (alumniUserIds.length > 0) {
      query = query.in("user_id", alumniUserIds);
    } else {
      query = query.in("user_id", ["__no_match__"]);
    }

    const { data: filteredAlumni } = await query;

    // The buggy approach returns 0 because no alumni have user_id matching roles
    assert.equal(filteredAlumni!.length, 0, "Role-based filtering returns 0 when no roles exist");
  });

  test("excludes soft-deleted alumni", async () => {
    stub.seed("alumni", [
      makeAlumni({ id: "alive-1", first_name: "Active" }),
      makeAlumni({ id: "alive-2", first_name: "Active2" }),
      makeAlumni({
        id: "deleted-1",
        first_name: "Deleted",
        deleted_at: new Date().toISOString(),
      }),
    ]);

    const { data } = await stub
      .from("alumni")
      .select(
        "id, first_name, last_name, photo_url, position_title, job_title, current_company, graduation_year, industry, current_city"
      )
      .eq("organization_id", ORG_ID)
      .is("deleted_at", null);

    assert.equal(data!.length, 2, "Should exclude soft-deleted alumni");
    const names = data!.map((a) => a.first_name);
    assert.ok(!names.includes("Deleted"), "Deleted alumni should not appear");
  });

  test("filters by organization_id", async () => {
    stub.seed("alumni", [
      makeAlumni({ id: "org1-1", organization_id: ORG_ID }),
      makeAlumni({ id: "org1-2", organization_id: ORG_ID }),
      makeAlumni({ id: "org2-1", organization_id: "other-org" }),
    ]);

    const { data } = await stub
      .from("alumni")
      .select(
        "id, first_name, last_name, photo_url, position_title, job_title, current_company, graduation_year, industry, current_city"
      )
      .eq("organization_id", ORG_ID)
      .is("deleted_at", null);

    assert.equal(data!.length, 2, "Should only return alumni for the specified org");
  });

  test("orders by graduation_year descending", async () => {
    stub.seed("alumni", [
      makeAlumni({ id: "a1", graduation_year: 2018 }),
      makeAlumni({ id: "a2", graduation_year: 2022 }),
      makeAlumni({ id: "a3", graduation_year: 2015 }),
    ]);

    const { data } = await stub
      .from("alumni")
      .select(
        "id, first_name, last_name, photo_url, position_title, job_title, current_company, graduation_year, industry, current_city"
      )
      .eq("organization_id", ORG_ID)
      .is("deleted_at", null)
      .order("graduation_year", { ascending: false });

    assert.equal(data!.length, 3);
    assert.equal(data![0].graduation_year, 2022);
    assert.equal(data![1].graduation_year, 2018);
    assert.equal(data![2].graduation_year, 2015);
  });

  test("filter dropdown query returns all non-deleted alumni for the org", async () => {
    stub.seed("alumni", [
      makeAlumni({
        id: "a1",
        graduation_year: 2020,
        industry: "Tech",
        current_company: "Acme",
        current_city: "Denver",
        position_title: "Engineer",
      }),
      makeAlumni({
        id: "a2",
        graduation_year: 2021,
        industry: "Finance",
        current_company: "BigCo",
        current_city: "NYC",
        position_title: "Analyst",
      }),
      makeAlumni({
        id: "a3",
        graduation_year: 2020,
        industry: "Tech",
        current_company: "Acme",
        current_city: "Denver",
        position_title: "Manager",
        deleted_at: new Date().toISOString(),
      }),
    ]);

    const { data: allAlumni } = await stub
      .from("alumni")
      .select("graduation_year, industry, current_company, current_city, position_title")
      .eq("organization_id", ORG_ID)
      .is("deleted_at", null);

    assert.equal(allAlumni!.length, 2, "Filter dropdown query excludes deleted");
    const years = [...new Set(allAlumni!.map((a) => a.graduation_year).filter(Boolean))];
    assert.equal(years.length, 2, "Should have 2 unique years");
  });
});
