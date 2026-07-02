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

test("every candidate must be open to networking, whatever their type", () => {
  const member = person({ personType: "member", openToNetworking: false });
  const openMember = person({ personType: "member", openToNetworking: true });
  const alumnus = person({ personType: "alumni", openToNetworking: false });
  const openAlumnus = person({ personType: "alumni", openToNetworking: true });
  assert.equal(isConnectionEdgeAllowed(member, alumnus), false);
  assert.equal(isConnectionEdgeAllowed(member, openAlumnus), true);
  assert.equal(isConnectionEdgeAllowed(alumnus, member), false);
  assert.equal(isConnectionEdgeAllowed(alumnus, openMember), true);
});

test("a non-consenting source can still VIEW suggestions (member source)", () => {
  const closedMember = person({ personType: "member", openToNetworking: false });
  const openAlumnus = person({ personType: "alumni", openToNetworking: true });
  assert.equal(isConnectionEdgeAllowed(closedMember, openAlumnus), true);
});

test("alumni → alumni additionally requires the SOURCE alumnus to be open to networking", () => {
  const closedSource = person({ personType: "alumni", openToNetworking: false });
  const openSource = person({ personType: "alumni", openToNetworking: true });
  const candidate = person({ personType: "alumni", openToNetworking: true });
  assert.equal(isConnectionEdgeAllowed(closedSource, candidate), false);
  assert.equal(isConnectionEdgeAllowed(openSource, candidate), true);
});

test("a parent on either end must be open to networking", () => {
  const openMember = person({ personType: "member", openToNetworking: true });
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
    alum({ id: "a0000000-0000-0000-0000-000000000002", user_id: "u-peer1", open_to_networking: true }),
    alum({ id: "a0000000-0000-0000-0000-000000000003", user_id: "u-peer2", open_to_networking: true }),
  ]);

  const result = await suggestFor(stub, "alumni", sourceId);
  assert.equal(result.suggestions.length, 0);
});

test("open alumnus source DOES see opted-in alumni candidates", async () => {
  const stub = createSupabaseStub();
  const sourceId = "a0000000-0000-0000-0000-000000000001";
  stub.seed("alumni", [
    alum({ id: sourceId, user_id: "u-src", open_to_networking: true }),
    alum({ id: "a0000000-0000-0000-0000-000000000002", user_id: "u-peer1", open_to_networking: true }),
    alum({ id: "a0000000-0000-0000-0000-000000000003", user_id: "u-peer2", open_to_networking: true }),
  ]);

  const result = await suggestFor(stub, "alumni", sourceId);
  assert.ok(result.suggestions.length >= 1, "open alumnus should see alumni peers");
  assert.ok(result.suggestions.every((s) => s.person_type === "alumni"));
});

test("a non-consenting alumnus is hidden from a member viewer", async () => {
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
    alum({ id: "a0000000-0000-0000-0000-000000000010", user_id: "u-open", open_to_networking: true, first_name: "Opal" }),
  ]);

  const result = await suggestFor(stub, "member", memberId);
  assert.ok(result.suggestions.length >= 1, "opted-in alumni still surface");
  assert.ok(
    result.suggestions.every((s) => s.name !== "Al Umni"),
    "the non-consenting alumnus must not surface"
  );
});

test("a non-consenting member is hidden from a member viewer", async () => {
  const stub = createSupabaseStub();
  const viewerId = "b0000000-0000-0000-0000-000000000001";
  const memberRow = (overrides: Record<string, unknown>) => ({
    organization_id: ORG_ID,
    status: "active",
    deleted_at: null,
    email: null,
    role: "Captain",
    current_company: "Acme",
    graduation_year: 2018,
    open_to_networking: false,
    ...overrides,
  });
  stub.seed("members", [
    memberRow({ id: viewerId, user_id: "u-viewer", first_name: "Mia", last_name: "Member" }),
    memberRow({
      id: "b0000000-0000-0000-0000-000000000002",
      user_id: "u-closed",
      first_name: "Cal",
      last_name: "Closed",
    }),
    memberRow({
      id: "b0000000-0000-0000-0000-000000000003",
      user_id: "u-open",
      first_name: "Opal",
      last_name: "Open",
      open_to_networking: true,
    }),
  ]);

  const result = await suggestFor(stub, "member", viewerId);
  assert.ok(
    result.suggestions.every((s) => s.name !== "Cal Closed"),
    "the non-consenting member must not surface"
  );
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

test("buildProjectedPeople: consent follows the surfaced identity, not any row", () => {
  const projected = buildProjectedPeople({
    members: [],
    alumni: [
      alum({ id: "x1", user_id: "shared", open_to_networking: false }) as any,
    ],
    parents: [
      parent({ id: "x2", user_id: "shared", open_to_networking: true }) as any,
    ],
  });
  // Linked alumni+parent collapse to one node projecting as alumni (precedence).
  // Opting in as a parent must NOT expose the alumni identity.
  const node = [...projected.values()].find((p) => p.userId === "shared");
  assert.ok(node);
  assert.equal(node!.personType, "alumni");
  assert.equal(node!.openToNetworking, false);
});

test("buildProjectedPeople: opting in on the surfaced identity's row counts", () => {
  const projected = buildProjectedPeople({
    members: [],
    alumni: [
      alum({ id: "x1", user_id: "shared", open_to_networking: true }) as any,
    ],
    parents: [
      parent({ id: "x2", user_id: "shared", open_to_networking: false }) as any,
    ],
  });
  const node = [...projected.values()].find((p) => p.userId === "shared");
  assert.ok(node);
  assert.equal(node!.personType, "alumni");
  assert.equal(node!.openToNetworking, true);
});
