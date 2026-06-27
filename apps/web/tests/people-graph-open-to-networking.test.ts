/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import { suggestConnections } from "../src/lib/people-graph/suggestions.ts";
import { isConnectionEdgeAllowed } from "../src/lib/people-graph/suggestions.ts";
import {
  buildProjectedPeople,
  type ProjectedPerson,
} from "../src/lib/people-graph/people.ts";
import { resetSuggestionTelemetryForTests } from "../src/lib/people-graph/telemetry.ts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  resetSuggestionTelemetryForTests();
});

// ── Shared career fields so candidates actually qualify (shared company + industry).
function alum(overrides: Record<string, unknown>) {
  return {
    organization_id: ORG_ID,
    deleted_at: null,
    first_name: "Al",
    last_name: "Umni",
    email: null,
    major: "Computer Science",
    current_company: "Acme",
    industry: "Technology",
    current_city: "Austin",
    graduation_year: 2018,
    position_title: "Engineer",
    job_title: null,
    open_to_networking: false,
    ...overrides,
  };
}

function parent(overrides: Record<string, unknown>) {
  return {
    organization_id: ORG_ID,
    deleted_at: null,
    first_name: "Pa",
    last_name: "Rent",
    email: null,
    major: "Computer Science",
    current_company: "Acme",
    industry: "Technology",
    current_city: "Austin",
    position_title: "Director",
    job_title: null,
    open_to_networking: false,
    ...overrides,
  };
}

async function suggestFor(
  stub: ReturnType<typeof createSupabaseStub>,
  person_type: "member" | "alumni" | "parent",
  person_id: string
) {
  return suggestConnections({
    orgId: ORG_ID,
    serviceSupabase: stub as any,
    args: { person_type, person_id, display_limit: 12 },
  });
}

// ── isConnectionEdgeAllowed: the consent gate, unit-level ─────────────────────

function person(p: Partial<ProjectedPerson> & Pick<ProjectedPerson, "personType">): ProjectedPerson {
  return {
    orgId: ORG_ID,
    personKey: p.personKey ?? `k:${Math.random()}`,
    personType: p.personType,
    personId: p.personId ?? "id",
    memberId: null,
    alumniId: null,
    parentId: null,
    userId: null,
    name: "X",
    email: null,
    role: null,
    major: null,
    currentCompany: null,
    industry: null,
    roleFamily: null,
    graduationYear: null,
    currentCity: null,
    openToNetworking: p.openToNetworking ?? false,
  };
}

test("members ↔ alumni edges are NOT consent-gated (unchanged from Phase 1)", () => {
  const member = person({ personType: "member", openToNetworking: false });
  const alumnus = person({ personType: "alumni", openToNetworking: false });
  assert.equal(isConnectionEdgeAllowed(member, alumnus), true);
  assert.equal(isConnectionEdgeAllowed(alumnus, member), true);
});

test("alumni → alumni requires the SOURCE alumnus to be open to networking", () => {
  const closedSource = person({ personType: "alumni", openToNetworking: false });
  const openSource = person({ personType: "alumni", openToNetworking: true });
  const candidate = person({ personType: "alumni", openToNetworking: false });
  assert.equal(isConnectionEdgeAllowed(closedSource, candidate), false);
  assert.equal(isConnectionEdgeAllowed(openSource, candidate), true);
});

test("a parent on either end must be open to networking", () => {
  const openMember = person({ personType: "member" });
  const closedParent = person({ personType: "parent", openToNetworking: false });
  const openParent = person({ personType: "parent", openToNetworking: true });
  assert.equal(isConnectionEdgeAllowed(openMember, closedParent), false);
  assert.equal(isConnectionEdgeAllowed(openMember, openParent), true);
  assert.equal(isConnectionEdgeAllowed(closedParent, openMember), false);
  assert.equal(isConnectionEdgeAllowed(openParent, openMember), true);
});

// ── Engine end-to-end over the stub ───────────────────────────────────────────

test("non-open alumnus source does NOT see alumni candidates", async () => {
  const stub = createSupabaseStub();
  const sourceId = "a0000000-0000-0000-0000-000000000001";
  stub.seed("alumni", [
    alum({ id: sourceId, user_id: "u-src", open_to_networking: false }),
    alum({ id: "a0000000-0000-0000-0000-000000000002", user_id: "u-peer1" }),
    alum({ id: "a0000000-0000-0000-0000-000000000003", user_id: "u-peer2" }),
  ]);

  const result = await suggestFor(stub, "alumni", sourceId);
  assert.equal(result.suggestions.length, 0);
});

test("open alumnus source DOES see alumni candidates", async () => {
  const stub = createSupabaseStub();
  const sourceId = "a0000000-0000-0000-0000-000000000001";
  stub.seed("alumni", [
    alum({ id: sourceId, user_id: "u-src", open_to_networking: true }),
    alum({ id: "a0000000-0000-0000-0000-000000000002", user_id: "u-peer1" }),
    alum({ id: "a0000000-0000-0000-0000-000000000003", user_id: "u-peer2" }),
  ]);

  const result = await suggestFor(stub, "alumni", sourceId);
  assert.ok(result.suggestions.length >= 1, "open alumnus should see alumni peers");
  assert.ok(result.suggestions.every((s) => s.person_type === "alumni"));
});

test("member source still sees alumni candidates regardless of consent (members↔alumni live)", async () => {
  const stub = createSupabaseStub();
  const memberId = "b0000000-0000-0000-0000-000000000001";
  stub.seed("members", [
    {
      id: memberId,
      organization_id: ORG_ID,
      user_id: "u-member",
      status: "active",
      deleted_at: null,
      first_name: "Mia",
      last_name: "Member",
      email: null,
      role: "Captain",
      current_company: "Acme",
      graduation_year: 2018,
      open_to_networking: false,
    },
  ]);
  stub.seed("alumni", [
    alum({ id: "a0000000-0000-0000-0000-000000000009", user_id: "u-peer", open_to_networking: false }),
  ]);

  const result = await suggestFor(stub, "member", memberId);
  assert.ok(result.suggestions.length >= 1, "member should still see alumni peers");
});

test("only opted-in parents are surfaced to a member viewer", async () => {
  const stub = createSupabaseStub();
  const memberId = "b0000000-0000-0000-0000-000000000001";
  stub.seed("members", [
    {
      id: memberId,
      organization_id: ORG_ID,
      user_id: "u-member",
      status: "active",
      deleted_at: null,
      first_name: "Mia",
      last_name: "Member",
      email: null,
      role: "Captain",
      current_company: "Acme",
      graduation_year: 2018,
      open_to_networking: false,
    },
  ]);
  stub.seed("parents", [
    parent({ id: "p0000000-0000-0000-0000-000000000001", user_id: "u-open", open_to_networking: true, first_name: "Olivia" }),
    parent({ id: "p0000000-0000-0000-0000-000000000002", user_id: "u-closed", open_to_networking: false, first_name: "Casey" }),
    parent({ id: "p0000000-0000-0000-0000-000000000003", user_id: null, open_to_networking: false, first_name: "Una" }),
    parent({ id: "p0000000-0000-0000-0000-000000000004", user_id: "u-del", open_to_networking: true, deleted_at: "2026-01-01T00:00:00.000Z", first_name: "Del" }),
  ]);

  const result = await suggestFor(stub, "member", memberId);
  const parentSuggestions = result.suggestions.filter((s) => s.person_type === "parent");
  assert.equal(parentSuggestions.length, 1, "exactly the one opted-in, non-deleted parent");
  assert.equal(parentSuggestions[0].name, "Olivia Rent");
});

test("buildProjectedPeople: openToNetworking true if any contributing row opted in", () => {
  const projected = buildProjectedPeople({
    members: [],
    alumni: [
      alum({ id: "x1", user_id: "shared", open_to_networking: false }) as any,
    ],
    parents: [
      parent({ id: "x2", user_id: "shared", open_to_networking: true }) as any,
    ],
  });
  // Linked alumni+parent collapse to one node; opted-in on either => true.
  const node = [...projected.values()].find((p) => p.userId === "shared");
  assert.ok(node);
  assert.equal(node!.openToNetworking, true);
  // The linked person projects as alumni (alumni outranks parent in precedence).
  assert.equal(node!.personType, "alumni");
});
