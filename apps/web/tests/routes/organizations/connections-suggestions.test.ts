/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import {
  getViewerConnectionSuggestions,
  CONNECTIONS_PAGE_DISPLAY_LIMIT,
} from "../../../src/lib/connections/viewer-suggestions.ts";
import { resetSuggestionTelemetryForTests } from "../../../src/lib/people-graph/telemetry.ts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const VIEWER_USER_ID = "00000000-0000-0000-0000-0000000000aa";

const routeSource = await readFile(
  new URL(
    "../../../src/app/api/organizations/[organizationId]/connections/suggestions/route.ts",
    import.meta.url
  ),
  "utf8"
);
const profileDirectChatRouteSource = await readFile(
  new URL(
    "../../../src/app/api/organizations/[organizationId]/direct-chat/profile/route.ts",
    import.meta.url
  ),
  "utf8"
);

beforeEach(() => {
  resetSuggestionTelemetryForTests();
});

// ── Source assertions: the route's authorization + safety invariants ─────────

test("suggestions route exports GET and validates the org uuid", () => {
  assert.match(routeSource, /export async function GET/);
  assert.match(routeSource, /baseSchemas\.uuid\.safeParse\(organizationId\)/);
  assert.match(routeSource, /Invalid identifier/);
});

test("suggestions route is a member feature gated on chat-eligible roles, not admin-only", () => {
  // Must NOT hard-gate on role === "admin"; must consult the chat-eligible set.
  assert.doesNotMatch(routeSource, /role !== "admin"/);
  assert.match(routeSource, /CHAT_ELIGIBLE_ORG_ROLES/);
  assert.match(routeSource, /Forbidden/);
});

test("suggestions route normalizes the membership role before the eligibility check", () => {
  // getOrgMembership returns the RAW role; without normalizeRole a "member" row
  // would never match CHAT_ELIGIBLE_ORG_ROLES ("active_member").
  assert.match(routeSource, /normalizeRole/);
});

test("suggestions route returns 401 for unauthenticated and rate-limits", () => {
  assert.match(routeSource, /Unauthorized/);
  assert.match(routeSource, /checkRateLimit/);
  assert.match(routeSource, /buildRateLimitResponse/);
});

test("mobile connections routes authenticate with the Bearer-aware API client", () => {
  for (const [name, source] of [
    ["suggestions", routeSource],
    ["profile direct-chat", profileDirectChatRouteSource],
  ] as const) {
    assert.match(
      source,
      /createAuthenticatedApiClient\(\s*req\s*\)/,
      `${name} route must honor mobile Authorization: Bearer tokens`,
    );
    assert.doesNotMatch(
      source,
      /from "@\/lib\/supabase\/server"/,
      `${name} route must not authenticate with the cookie-only server client`,
    );
  }
});

test("suggestions route sources suggestions from the viewer via the shared helper", () => {
  // R5 invariant: the route must not build its own source resolution — it must
  // go through getViewerConnectionSuggestions, which sources from the viewer.
  assert.match(routeSource, /getViewerConnectionSuggestions/);
  assert.match(routeSource, /viewerUserId: user\.id/);
});

// ── Behavioral: the shared source-from-viewer helper over a seeded stub ───────
// The route delegates all suggestion logic to getViewerConnectionSuggestions, so
// exercising that helper against the real engine + stub covers the route's data
// path (the handler itself only adds HTTP auth/rate-limit plumbing, asserted above).

function seedViewerAsMember(stub: ReturnType<typeof createSupabaseStub>) {
  stub.seed("members", [
    {
      id: "mmmmmmmm-mmmm-mmmm-mmmm-mmmmmmmmmmm1",
      organization_id: ORG_ID,
      user_id: VIEWER_USER_ID,
      status: "active",
      deleted_at: null,
      first_name: "Vera",
      last_name: "Viewer",
      email: "vera@example.com",
      role: "Captain",
      current_company: "Acme",
      graduation_year: 2018,
      created_at: "2026-03-01T00:00:00.000Z",
    },
  ]);
}

function seedAlumniPeers(stub: ReturnType<typeof createSupabaseStub>, count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa00${(i + 10).toString().padStart(2, "0")}`,
    organization_id: ORG_ID,
    user_id: `00000000-0000-0000-0000-0000000001${(i + 10).toString().padStart(2, "0")}`,
    deleted_at: null,
    first_name: `Peer${i}`,
    last_name: "Alum",
    email: `peer${i}@example.com`,
    major: "Computer Science",
    // Share the company + industry with the viewer so they qualify as candidates.
    current_company: "Acme",
    industry: "Technology",
    current_city: "Austin",
    graduation_year: 2018,
    position_title: "Engineer",
    job_title: null,
    created_at: "2026-03-02T00:00:00.000Z",
  }));
  stub.seed("alumni", rows);
}

test("happy: active member viewer with shared-company alumni gets scored suggestions", async () => {
  const stub = createSupabaseStub();
  seedViewerAsMember(stub);
  seedAlumniPeers(stub, 2);

  const result = await getViewerConnectionSuggestions({
    serviceSupabase: stub as any,
    orgId: ORG_ID,
    viewerUserId: VIEWER_USER_ID,
  });

  assert.equal(result.state, "ok");
  assert.ok(result.suggestions.length >= 1);
  // Display-ready shape the card consumes.
  const first = result.suggestions[0];
  assert.ok(first.person_type === "member" || first.person_type === "alumni");
  assert.equal(typeof first.person_id, "string");
  assert.ok(Array.isArray(first.reasons));
  assert.ok(first.reasons.every((r) => typeof r.label === "string"));
});

test("empty source: viewer with no member/alumni row returns no_source, not an error", async () => {
  const stub = createSupabaseStub();
  // Only peers exist; the viewer has no projected row in this org.
  seedAlumniPeers(stub, 2);

  const result = await getViewerConnectionSuggestions({
    serviceSupabase: stub as any,
    orgId: ORG_ID,
    viewerUserId: VIEWER_USER_ID,
  });

  assert.equal(result.state, "no_source");
  assert.deepEqual(result.suggestions, []);
});

test("lone viewer: member with no peers resolves but yields an empty list", async () => {
  const stub = createSupabaseStub();
  seedViewerAsMember(stub);

  const result = await getViewerConnectionSuggestions({
    serviceSupabase: stub as any,
    orgId: ORG_ID,
    viewerUserId: VIEWER_USER_ID,
  });

  assert.equal(result.state, "ok");
  assert.deepEqual(result.suggestions, []);
});

test("RLS: a soft-deleted viewer member row is NOT used as a source", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [
    {
      id: "mmmmmmmm-mmmm-mmmm-mmmm-mmmmmmmmmmmd",
      organization_id: ORG_ID,
      user_id: VIEWER_USER_ID,
      status: "active",
      deleted_at: "2026-01-01T00:00:00.000Z",
      first_name: "Gone",
      last_name: "Viewer",
      email: "gone@example.com",
      role: null,
      current_company: "Acme",
      graduation_year: 2018,
      created_at: "2026-03-01T00:00:00.000Z",
    },
  ]);
  seedAlumniPeers(stub, 2);

  const result = await getViewerConnectionSuggestions({
    serviceSupabase: stub as any,
    orgId: ORG_ID,
    viewerUserId: VIEWER_USER_ID,
  });

  // No live source row → no_source, never a leak of peers.
  assert.equal(result.state, "no_source");
});

test("display_limit threads through: page cap surfaces more than the chat cap of 3", async () => {
  const stub = createSupabaseStub();
  seedViewerAsMember(stub);
  // Seed more qualifying peers than the chat cap so the larger cap is observable.
  seedAlumniPeers(stub, 6);

  const capped = await getViewerConnectionSuggestions({
    serviceSupabase: stub as any,
    orgId: ORG_ID,
    viewerUserId: VIEWER_USER_ID,
    displayLimit: 3,
  });
  const wide = await getViewerConnectionSuggestions({
    serviceSupabase: stub as any,
    orgId: ORG_ID,
    viewerUserId: VIEWER_USER_ID,
    displayLimit: CONNECTIONS_PAGE_DISPLAY_LIMIT,
  });

  assert.equal(capped.state, "ok");
  assert.equal(wide.state, "ok");
  assert.equal(capped.suggestions.length, 3);
  assert.ok(
    wide.suggestions.length > capped.suggestions.length,
    `expected wide (${wide.suggestions.length}) > capped (${capped.suggestions.length})`
  );
});
