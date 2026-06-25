/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import { getOrgDataHealth } from "../../../src/lib/health/org-data-health.ts";
import { checkReachabilityHealth } from "../../../src/lib/health/reachability-health.ts";
import { normalizeRole } from "../../../src/lib/auth/role-utils.ts";
import { resetSuggestionTelemetryForTests } from "../../../src/lib/people-graph/telemetry.ts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

/** Seed an active chat-eligible role row for a linked user. */
function seedEligibleRole(stub: ReturnType<typeof createSupabaseStub>, userId: string) {
  stub.seed("user_organization_roles", [
    { organization_id: ORG_ID, user_id: userId, status: "active", role: "alumni" },
  ]);
}

beforeEach(() => {
  resetSuggestionTelemetryForTests();
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

test("getOrgDataHealth returns the reachability section alongside rag + enrichment", async () => {
  const stub = createSupabaseStub();
  stub.seed("alumni", [
    { id: "al-linked", organization_id: ORG_ID, user_id: "u1", email: "l@x.com", deleted_at: null },
  ]);
  seedEligibleRole(stub, "u1");

  const report = await getOrgDataHealth(stub as any, ORG_ID, {
    now: Date.parse("2026-06-15T12:00:00.000Z"),
  });

  assert.ok(report.reachability, "report carries a reachability section");
  assert.equal(report.reachability.orgId, ORG_ID);
  assert.equal(report.reachability.counts.totalAlumni, 1);
  assert.equal(report.reachability.counts.linkedAlumni, 1);
});

// --- reachability segmentation ---

test("checkReachabilityHealth segments alumni across all five reachability states", async () => {
  const stub = createSupabaseStub();
  stub.seed("alumni", [
    // linkedEligible: linked + active chat-eligible role
    { id: "a-eligible", organization_id: ORG_ID, user_id: "u-elig", email: "e@x.com", deleted_at: null },
    // linkedNotEligible: linked, but no active chat-eligible role
    { id: "a-noteligible", organization_id: ORG_ID, user_id: "u-noelig", email: "n@x.com", deleted_at: null },
    // unclaimedWithEmail
    { id: "a-unclaimed-email", organization_id: ORG_ID, user_id: null, email: "u@x.com", deleted_at: null },
    // unclaimedNoEmail
    { id: "a-unclaimed-noemail", organization_id: ORG_ID, user_id: null, email: null, deleted_at: null },
    // softDeleted (excluded from totals)
    { id: "a-deleted", organization_id: ORG_ID, user_id: "u-del", email: "d@x.com", deleted_at: "2026-01-01T00:00:00.000Z" },
  ]);
  seedEligibleRole(stub, "u-elig");
  // u-noelig has an *inactive* role → not eligible
  stub.seed("user_organization_roles", [
    { organization_id: ORG_ID, user_id: "u-noelig", status: "inactive", role: "alumni" },
  ]);

  const report = await checkReachabilityHealth(stub as any, ORG_ID);

  assert.deepEqual(report.segments, {
    linkedEligible: 1,
    linkedNotEligible: 1,
    unclaimedWithEmail: 1,
    unclaimedNoEmail: 1,
    softDeleted: 1,
  });
  // Total/linked exclude the soft-deleted row.
  assert.equal(report.counts.totalAlumni, 4);
  assert.equal(report.counts.linkedAlumni, 2);
  assert.equal(report.counts.unclaimedWithEmail, 1);
  // unclaimedWithEmail > 0 → gaps
  assert.equal(report.state, "gaps");
});

test("checkReachabilityHealth counts a linked-but-not-chat-eligible alum as linkedNotEligible", async () => {
  const stub = createSupabaseStub();
  stub.seed("alumni", [
    { id: "a", organization_id: ORG_ID, user_id: "u", email: "e@x.com", deleted_at: null },
  ]);
  // A role that is active but NOT in CHAT_ELIGIBLE_ORG_ROLES.
  stub.seed("user_organization_roles", [
    { organization_id: ORG_ID, user_id: "u", status: "active", role: "viewer" },
  ]);

  const report = await checkReachabilityHealth(stub as any, ORG_ID);

  assert.equal(report.segments.linkedEligible, 0);
  assert.equal(report.segments.linkedNotEligible, 1);
});

test("checkReachabilityHealth excludes soft-deleted alumni from total/linked/unclaimed", async () => {
  const stub = createSupabaseStub();
  stub.seed("alumni", [
    { id: "live", organization_id: ORG_ID, user_id: null, email: "x@x.com", deleted_at: null },
    { id: "dead-linked", organization_id: ORG_ID, user_id: "u", email: "y@x.com", deleted_at: "2026-01-01T00:00:00.000Z" },
    { id: "dead-unclaimed", organization_id: ORG_ID, user_id: null, email: "z@x.com", deleted_at: "2026-01-01T00:00:00.000Z" },
  ]);
  seedEligibleRole(stub, "u");

  const report = await checkReachabilityHealth(stub as any, ORG_ID);

  assert.equal(report.counts.totalAlumni, 1);
  assert.equal(report.counts.linkedAlumni, 0);
  assert.equal(report.segments.unclaimedWithEmail, 1);
  assert.equal(report.segments.softDeleted, 2);
});

// --- chat-eligible % edge cases ---

test("checkReachabilityHealth reports 0% chat-eligible when no alumni are linked", async () => {
  const stub = createSupabaseStub();
  stub.seed("alumni", [
    { id: "a", organization_id: ORG_ID, user_id: null, email: "x@x.com", deleted_at: null },
  ]);

  const report = await checkReachabilityHealth(stub as any, ORG_ID);

  assert.equal(report.counts.linkedAlumni, 0);
  assert.equal(report.counts.chatEligiblePercent, 0);
});

test("checkReachabilityHealth reports 100% when the only linked alum is chat-eligible", async () => {
  const stub = createSupabaseStub();
  stub.seed("alumni", [
    { id: "a", organization_id: ORG_ID, user_id: "u", email: "x@x.com", deleted_at: null },
  ]);
  seedEligibleRole(stub, "u");

  const report = await checkReachabilityHealth(stub as any, ORG_ID);

  assert.equal(report.counts.chatEligiblePercent, 100);
});

test("checkReachabilityHealth reports 60% when 3 of 5 linked alumni are chat-eligible", async () => {
  const stub = createSupabaseStub();
  const linked = [];
  for (let i = 0; i < 5; i++) {
    linked.push({
      id: `a${i}`,
      organization_id: ORG_ID,
      user_id: `u${i}`,
      email: `e${i}@x.com`,
      deleted_at: null,
    });
  }
  stub.seed("alumni", linked);
  // Only u0, u1, u2 carry an active chat-eligible role.
  for (const userId of ["u0", "u1", "u2"]) seedEligibleRole(stub, userId);

  const report = await checkReachabilityHealth(stub as any, ORG_ID);

  assert.equal(report.counts.linkedAlumni, 5);
  assert.equal(report.segments.linkedEligible, 3);
  assert.equal(report.counts.chatEligiblePercent, 60);
});

test("checkReachabilityHealth degrades to zeroed counts when the alumni query fails", async () => {
  const stub = createSupabaseStub();
  stub.simulateError("alumni", { message: "db down" });

  const report = await checkReachabilityHealth(stub as any, ORG_ID);

  assert.equal(report.state, "degraded");
  assert.equal(report.reason, "db down");
  assert.deepEqual(report.segments, {
    linkedEligible: 0,
    linkedNotEligible: 0,
    unclaimedWithEmail: 0,
    unclaimedNoEmail: 0,
    softDeleted: 0,
  });
  assert.deepEqual(report.counts, {
    totalAlumni: 0,
    linkedAlumni: 0,
    chatEligiblePercent: 0,
    unclaimedWithEmail: 0,
  });
});
