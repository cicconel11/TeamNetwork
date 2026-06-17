/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import { getOrgDataHealth } from "../../../src/lib/health/org-data-health.ts";
import { normalizeRole } from "../../../src/lib/auth/role-utils.ts";
import { resetFalkorTelemetryForTests } from "../../../src/lib/falkordb/telemetry.ts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  resetFalkorTelemetryForTests();
});

// --- admin gate (the route's authorization decision) ---

test("data-health admin gate admits only the admin role", () => {
  assert.equal(normalizeRole("admin"), "admin");
  assert.notEqual(normalizeRole("member"), "admin");
  assert.notEqual(normalizeRole("alumni"), "admin");
  assert.equal(normalizeRole(null), null);
});

// --- aggregation across the RAG + enrichment pipelines ---
// (The people-graph is served from Postgres, so the report has no graph section.)

test("getOrgDataHealth returns RAG and enrichment sections for a healthy org", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [
    {
      id: "m1",
      organization_id: ORG_ID,
      user_id: "u1",
      status: "active",
      first_name: "A",
      last_name: "B",
      email: "a@x.com",
      role: null,
      current_company: null,
      graduation_year: null,
      created_at: "2026-01-01T00:00:00.000Z",
      deleted_at: null,
    },
  ]);

  const report = await getOrgDataHealth(stub as any, ORG_ID, {
    now: Date.parse("2026-06-15T12:00:00.000Z"),
  });

  assert.equal(report.orgId, ORG_ID);
  assert.equal(report.rag.state, "ok");
  assert.equal(report.enrichment.state, "ok");
});

test("getOrgDataHealth is org-scoped and surfaces another org's data nowhere", async () => {
  const stub = createSupabaseStub();
  const OTHER = "22222222-2222-2222-2222-222222222222";
  stub.seed("members", [
    {
      id: "m-other",
      organization_id: OTHER,
      user_id: null,
      status: "active",
      first_name: "X",
      last_name: "Y",
      email: "x@y.com",
      role: null,
      current_company: null,
      graduation_year: null,
      created_at: "2026-01-01T00:00:00.000Z",
      deleted_at: null,
    },
  ]);

  const report = await getOrgDataHealth(stub as any, ORG_ID, {
    now: Date.parse("2026-06-15T12:00:00.000Z"),
  });

  // The other org's userless member must not appear in this org's report.
  assert.deepEqual(report.enrichment.userlessRows, []);
  assert.equal(JSON.stringify(report).includes("m-other"), false);
});
