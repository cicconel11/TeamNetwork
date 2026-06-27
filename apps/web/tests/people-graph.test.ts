/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import {
  buildProjectedPeople,
  buildSourcePerson,
  type ProjectedPerson,
} from "../src/lib/people-graph/people.ts";
import {
  buildCandidatePool,
  scoreProjectedCandidates,
  suggestConnections,
} from "../src/lib/people-graph/suggestions.ts";
import {
  recordSuggestedCandidates,
  resetSuggestionTelemetryForTests,
} from "../src/lib/people-graph/telemetry.ts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  resetSuggestionTelemetryForTests();
});

function seedSuggestionFixture(stub: ReturnType<typeof createSupabaseStub>) {
  stub.seed("alumni", [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
      organization_id: ORG_ID,
      user_id: "00000000-0000-0000-0000-000000000001",
      first_name: "Alex",
      last_name: "Source",
      email: "alex@example.com",
      major: "Computer Science",
      current_company: "Acme",
      industry: "Technology",
      current_city: "Austin",
      graduation_year: 2018,
      position_title: "Engineer",
      job_title: null,
      // Source is opted in so alumni→alumni candidates surface (this fixture
      // tests ranking, not the consent gate).
      open_to_networking: true,
      deleted_at: null,
    },
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
      organization_id: ORG_ID,
      user_id: "00000000-0000-0000-0000-000000000002",
      first_name: "Dina",
      last_name: "Direct",
      email: "dina@example.com",
      major: null,
      current_company: "Acme",
      industry: null,
      current_city: null,
      graduation_year: 2018,
      position_title: "VP Product",
      job_title: null,
      deleted_at: null,
    },
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3",
      organization_id: ORG_ID,
      user_id: "00000000-0000-0000-0000-000000000003",
      first_name: "Sam",
      last_name: "Second",
      email: "sam@example.com",
      major: "Computer Science",
      current_company: null,
      industry: "Technology",
      current_city: "Austin",
      graduation_year: null,
      position_title: "Founder",
      job_title: null,
      deleted_at: null,
    },
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4",
      organization_id: ORG_ID,
      user_id: "00000000-0000-0000-0000-000000000004",
      first_name: "Ava",
      last_name: "Attribute",
      email: "ava@example.com",
      major: "Computer Science",
      current_company: "Acme",
      industry: "Technology",
      current_city: "Austin",
      graduation_year: 2018,
      position_title: "Investor",
      job_title: null,
      deleted_at: null,
    },
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5",
      organization_id: ORG_ID,
      user_id: "00000000-0000-0000-0000-000000000005",
      first_name: "Nora",
      last_name: "Sparse",
      email: "nora@example.com",
      major: null,
      current_company: null,
      industry: null,
      current_city: null,
      graduation_year: null,
      position_title: null,
      job_title: null,
      deleted_at: null,
    },
  ]);
}

function makeProjectedPerson(
  overrides: Partial<ProjectedPerson> & Pick<ProjectedPerson, "personKey" | "personId" | "name">
): ProjectedPerson {
  return {
    orgId: overrides.orgId ?? ORG_ID,
    personKey: overrides.personKey,
    personType: overrides.personType ?? "alumni",
    personId: overrides.personId,
    memberId: overrides.memberId ?? null,
    alumniId: overrides.alumniId ?? overrides.personId,
    parentId: overrides.parentId ?? null,
    userId: overrides.userId ?? null,
    name: overrides.name,
    email: overrides.email ?? null,
    role: overrides.role ?? null,
    major: overrides.major ?? null,
    currentCompany: overrides.currentCompany ?? null,
    industry: overrides.industry ?? null,
    roleFamily: overrides.roleFamily ?? null,
    graduationYear: overrides.graduationYear ?? null,
    currentCity: overrides.currentCity ?? null,
    // These fixtures exercise SCORING, not the networking-consent gate. Default
    // to opted-in so alumni→alumni scoring scenarios aren't suppressed by the
    // gate (the gate itself is covered in people-graph-open-to-networking.test).
    openToNetworking: overrides.openToNetworking ?? true,
  };
}

test("buildProjectedPeople dedupes by user_id and preserves null-user rows", () => {
  const projected = buildProjectedPeople({
    members: [
      {
        id: "member-1",
        organization_id: ORG_ID,
        user_id: "shared-user",
        deleted_at: null,
        status: "active",
        first_name: "Mia",
        last_name: "Member",
        email: "mia@example.com",
        role: "Captain",
        current_company: "Acme",
        graduation_year: 2025,
        created_at: "2026-03-01T00:00:00.000Z",
      },
      {
        id: "member-2",
        organization_id: ORG_ID,
        user_id: null,
        deleted_at: null,
        status: "active",
        first_name: "Null",
        last_name: "Member",
        email: "null-member@example.com",
        role: null,
        current_company: null,
        graduation_year: null,
        created_at: "2026-03-02T00:00:00.000Z",
      },
    ],
    alumni: [
      {
        id: "alumni-1",
        organization_id: ORG_ID,
        user_id: "shared-user",
        deleted_at: null,
        first_name: "Mia",
        last_name: "Alumni",
        email: "mia@example.com",
        major: "Computer Science",
        current_company: "Acme",
        industry: "Technology",
        current_city: "Austin",
        graduation_year: 2023,
        position_title: "Engineer",
        job_title: null,
        created_at: "2026-03-01T00:00:00.000Z",
      },
      {
        id: "alumni-2",
        organization_id: ORG_ID,
        user_id: null,
        deleted_at: null,
        first_name: "Null",
        last_name: "Alumni",
        email: "null-alumni@example.com",
        major: "History",
        current_company: null,
        industry: null,
        current_city: null,
        graduation_year: null,
        position_title: null,
        job_title: null,
        created_at: "2026-03-03T00:00:00.000Z",
      },
    ],
  });

  assert.equal(projected.size, 3);
  assert.deepEqual(projected.get(`${ORG_ID}:user:shared-user`), {
    orgId: ORG_ID,
    personKey: "user:shared-user",
    personType: "member",
    personId: "member-1",
    memberId: "member-1",
    alumniId: "alumni-1",
    parentId: null,
    userId: "shared-user",
    name: "Mia Member",
    email: "mia@example.com",
    role: "Engineer",
    major: "Computer Science",
    currentCompany: "Acme",
    industry: "Technology",
    roleFamily: "Engineering",
    graduationYear: 2023,
    currentCity: "Austin",
    openToNetworking: false,
  });
  assert.ok(projected.has(`${ORG_ID}:member:member-2`));
  assert.ok(projected.has(`${ORG_ID}:alumni:alumni-2`));
});

test("buildSourcePerson matches buildProjectedPeople for merged member+alumni", () => {
  const memberRow = {
    id: "member-1",
    organization_id: ORG_ID,
    user_id: "shared-user",
    deleted_at: null,
    status: "active",
    first_name: "Mia",
    last_name: "Member",
    email: "mia@example.com",
    role: "Captain",
    current_company: "Acme",
    graduation_year: 2025,
    created_at: "2026-03-01T00:00:00.000Z",
  };
  const alumniRow = {
    id: "alumni-1",
    organization_id: ORG_ID,
    user_id: "shared-user",
    deleted_at: null,
    first_name: "Mia",
    last_name: "Alumni",
    email: "mia@example.com",
    major: "Computer Science",
    current_company: "Acme",
    industry: "Technology",
    current_city: "Austin",
    graduation_year: 2023,
    position_title: "Engineer",
    job_title: null,
    created_at: "2026-03-01T00:00:00.000Z",
  };

  const fromBuild = buildSourcePerson({ memberRows: [memberRow], alumniRows: [alumniRow] });
  const fromProjection = buildProjectedPeople({
    members: [memberRow],
    alumni: [alumniRow],
  });

  assert.deepEqual(fromBuild, fromProjection.get(`${ORG_ID}:user:shared-user`));
});

test("buildSourcePerson matches buildProjectedPeople for member-only", () => {
  const memberRow = {
    id: "member-solo",
    organization_id: ORG_ID,
    user_id: null,
    deleted_at: null,
    status: "active",
    first_name: "Solo",
    last_name: "Member",
    email: "solo@example.com",
    role: "Treasurer",
    current_company: "Beta",
    graduation_year: 2024,
    created_at: "2026-03-01T00:00:00.000Z",
  };

  const fromBuild = buildSourcePerson({ memberRows: [memberRow], alumniRows: [] });
  const fromProjection = buildProjectedPeople({ members: [memberRow], alumni: [] });

  assert.deepEqual(fromBuild, fromProjection.get(`${ORG_ID}:member:member-solo`));
});

test("buildSourcePerson matches buildProjectedPeople for alumni-only", () => {
  const alumniRow = {
    id: "alumni-solo",
    organization_id: ORG_ID,
    user_id: null,
    deleted_at: null,
    first_name: "Solo",
    last_name: "Alumni",
    email: "solo-alumni@example.com",
    major: "History",
    current_company: null,
    industry: null,
    current_city: null,
    graduation_year: null,
    position_title: null,
    job_title: null,
    created_at: "2026-03-01T00:00:00.000Z",
  };

  const fromBuild = buildSourcePerson({ memberRows: [], alumniRows: [alumniRow] });
  const fromProjection = buildProjectedPeople({ members: [], alumni: [alumniRow] });

  assert.deepEqual(fromBuild, fromProjection.get(`${ORG_ID}:alumni:alumni-solo`));
});

test("buildProjectedPeople parses member company-role strings into canonical career signals", () => {
  const projected = buildProjectedPeople({
    members: [
      {
        id: "member-parse",
        organization_id: ORG_ID,
        user_id: null,
        deleted_at: null,
        status: "active",
        first_name: "Tyler",
        last_name: "Morrison",
        email: "tyler@example.com",
        role: "Student",
        current_company: "Microsoft (SWE intern)",
        graduation_year: 2028,
        created_at: "2026-03-01T00:00:00.000Z",
      },
    ],
    alumni: [],
  });

  assert.deepEqual(projected.get(`${ORG_ID}:member:member-parse`), {
    orgId: ORG_ID,
    personKey: "member:member-parse",
    personType: "member",
    personId: "member-parse",
    memberId: "member-parse",
    alumniId: null,
    parentId: null,
    userId: null,
    name: "Tyler Morrison",
    email: "tyler@example.com",
    role: "Student",
    major: null,
    currentCompany: "Microsoft",
    industry: "Technology",
    roleFamily: "Engineering",
    graduationYear: 2028,
    currentCity: null,
    openToNetworking: false,
  });
});

test("buildProjectedPeople prefers richer alumni company and industry over parsed member signals", () => {
  const projected = buildProjectedPeople({
    members: [
      {
        id: "member-linked",
        organization_id: ORG_ID,
        user_id: "shared-user",
        deleted_at: null,
        status: "active",
        first_name: "Zara",
        last_name: "Hassan",
        email: "zara@example.com",
        role: "Student",
        current_company: "Citadel (summer analyst)",
        graduation_year: 2027,
        created_at: "2026-03-01T00:00:00.000Z",
      },
    ],
    alumni: [
      {
        id: "alumni-linked",
        organization_id: ORG_ID,
        user_id: "shared-user",
        deleted_at: null,
        first_name: "Zara",
        last_name: "Hassan",
        email: "zara@example.com",
        major: "Economics",
        current_company: "Goldman Sachs",
        industry: "Banking",
        current_city: "New York",
        graduation_year: 2025,
        position_title: "Analyst",
        job_title: null,
        created_at: "2026-03-02T00:00:00.000Z",
      },
    ],
  });

  assert.deepEqual(projected.get(`${ORG_ID}:user:shared-user`), {
    orgId: ORG_ID,
    personKey: "user:shared-user",
    personType: "member",
    personId: "member-linked",
    memberId: "member-linked",
    alumniId: "alumni-linked",
    parentId: null,
    userId: "shared-user",
    name: "Zara Hassan",
    email: "zara@example.com",
    role: "Analyst",
    major: "Economics",
    currentCompany: "Goldman Sachs",
    industry: "Finance",
    roleFamily: "Finance",
    graduationYear: 2025,
    currentCity: "New York",
    openToNetworking: false,
  });
});

test("buildSourcePerson returns null for empty input", () => {
  const result = buildSourcePerson({ memberRows: [], alumniRows: [] });
  assert.equal(result, null);
});

test("buildSourcePerson matches buildProjectedPeople for duplicate complement rows", () => {
  const alumniRow = {
    id: "alumni-source",
    organization_id: ORG_ID,
    user_id: "shared-user",
    deleted_at: null,
    first_name: "Alex",
    last_name: "Source",
    email: "alex@example.com",
    major: null,
    current_company: null,
    industry: null,
    current_city: null,
    graduation_year: null,
    position_title: null,
    job_title: null,
    created_at: "2026-03-03T00:00:00.000Z",
  };
  const memberRows = [
    {
      id: "member-newer",
      organization_id: ORG_ID,
      user_id: "shared-user",
      deleted_at: null,
      status: "active",
      first_name: "Alex",
      last_name: "Source",
      email: "alex@example.com",
      role: "Vice President",
      current_company: "Beta",
      graduation_year: 2025,
      created_at: "2026-03-02T00:00:00.000Z",
    },
    {
      id: "member-older",
      organization_id: ORG_ID,
      user_id: "shared-user",
      deleted_at: null,
      status: "active",
      first_name: "Alex",
      last_name: "Source",
      email: "alex@example.com",
      role: "President",
      current_company: "Acme",
      graduation_year: 2024,
      created_at: "2026-03-01T00:00:00.000Z",
    },
  ];

  const fromBuild = buildSourcePerson({ memberRows, alumniRows: [alumniRow] });
  const fromProjection = buildProjectedPeople({ members: memberRows, alumni: [alumniRow] });

  assert.deepEqual(fromBuild, fromProjection.get(`${ORG_ID}:user:shared-user`));
});

test("suggestConnections returns deterministic SQL fallback ranking", async () => {
  const stub = createSupabaseStub();
  seedSuggestionFixture(stub);

  const result = await suggestConnections({
    orgId: ORG_ID,
    serviceSupabase: stub as any,
    args: {
      person_type: "alumni",
      person_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
    },
  });

  assert.equal(result.mode, "sql_fallback");
  assert.equal(result.fallback_reason, null);
  assert.equal(result.freshness.state, "fresh");
  assert.equal(result.state, "resolved");
  assert.equal(result.source_person?.name, "Alex Source");
  assert.deepEqual(
    result.suggestions.map((row) => ({
      name: row.name,
      score: row.score,
      reasonCodes: row.reasons.map((reason) => reason.code),
    })),
    [
      {
        name: "Ava Attribute",
        score: 40,
        reasonCodes: ["shared_industry", "shared_company", "shared_city", "graduation_proximity"],
      },
      {
        name: "Sam Second",
        score: 22,
        reasonCodes: ["shared_industry", "shared_city"],
      },
      {
        name: "Dina Direct",
        score: 18,
        reasonCodes: ["shared_company", "graduation_proximity"],
      },
    ]
  );
});

test("suggestConnections resolves Matt-family aliases and shorthand before ranking", async () => {
  const stub = createSupabaseStub();

  stub.seed("members", [
    {
      id: "member-matt",
      organization_id: ORG_ID,
      user_id: "user-matt",
      deleted_at: null,
      status: "active",
      first_name: "Matt",
      last_name: "Leonard",
      email: "matt@example.com",
      role: "Captain",
      current_company: "Acme",
      graduation_year: 2024,
      created_at: "2026-03-01T00:00:00.000Z",
    },
    {
      id: "member-dana",
      organization_id: ORG_ID,
      user_id: "user-dana",
      deleted_at: null,
      status: "active",
      first_name: "Dana",
      last_name: "Coach",
      email: "dana@example.com",
      role: "Coach",
      current_company: "Acme",
      graduation_year: 2024,
      created_at: "2026-03-02T00:00:00.000Z",
    },
  ]);

  const [matthew, shorthand] = await Promise.all([
    suggestConnections({
      orgId: ORG_ID,
      serviceSupabase: stub as any,
      args: { person_query: "Matthew Leonard" },
    }),
    suggestConnections({
      orgId: ORG_ID,
      serviceSupabase: stub as any,
      args: { person_query: "mat leo" },
    }),
  ]);

  assert.equal(matthew.state, "resolved");
  assert.equal(matthew.source_person?.name, "Matt Leonard");
  assert.equal(shorthand.state, "resolved");
  assert.equal(shorthand.source_person?.name, "Matt Leonard");
  assert.equal(matthew.suggestions[0]?.name, "Dana Coach");
});

test("suggestConnections suppresses generic company matches and keeps sources differentiated", async () => {
  const stub = createSupabaseStub();

  stub.seed("organizations", [
    {
      id: ORG_ID,
      name: "Test Organization",
      slug: "test-organization",
    },
  ]);

  stub.seed("members", [
    {
      id: "member-louis",
      organization_id: ORG_ID,
      user_id: "user-louis",
      deleted_at: null,
      status: "active",
      first_name: "Louis",
      last_name: "Ciccone",
      email: "louis@example.com",
      role: "Captain",
      current_company: "TeamNetwork",
      graduation_year: 2024,
      created_at: "2026-03-01T00:00:00.000Z",
    },
    {
      id: "member-matt",
      organization_id: ORG_ID,
      user_id: "user-matt",
      deleted_at: null,
      status: "active",
      first_name: "Matt",
      last_name: "Leonard",
      email: "matt@example.com",
      role: "Admin",
      current_company: "TeamNetwork",
      graduation_year: 2024,
      created_at: "2026-03-02T00:00:00.000Z",
    },
    {
      id: "member-matthew",
      organization_id: ORG_ID,
      user_id: "user-matthew",
      deleted_at: null,
      status: "active",
      first_name: "Matthew",
      last_name: "McKilloop",
      email: "matthew@example.com",
      role: "Admin",
      current_company: "TeamNetwork",
      graduation_year: 2027,
      created_at: "2026-03-03T00:00:00.000Z",
    },
  ]);

  stub.seed("alumni", [
    {
      id: "alumni-louis",
      organization_id: ORG_ID,
      user_id: "user-louis",
      first_name: "Louis",
      last_name: "Ciccone",
      email: "louis@example.com",
      major: null,
      current_company: "TeamNetwork",
      industry: "Sports",
      current_city: "Philadelphia",
      graduation_year: 2024,
      position_title: "Founder",
      job_title: null,
      deleted_at: null,
      created_at: "2026-03-04T00:00:00.000Z",
    },
    {
      id: "alumni-matt",
      organization_id: ORG_ID,
      user_id: "user-matt",
      first_name: "Matt",
      last_name: "Leonard",
      email: "matt@example.com",
      major: null,
      current_company: "TeamNetwork",
      industry: "Sports",
      current_city: "Philadelphia",
      graduation_year: 2024,
      position_title: "Coach",
      job_title: null,
      deleted_at: null,
      created_at: "2026-03-05T00:00:00.000Z",
    },
    {
      id: "alumni-matthew",
      organization_id: ORG_ID,
      user_id: "user-matthew",
      first_name: "Matthew",
      last_name: "McKilloop",
      email: "matthew@example.com",
      major: null,
      current_company: "TeamNetwork",
      industry: "Finance",
      current_city: "New York",
      graduation_year: 2027,
      position_title: "Analyst",
      job_title: null,
      deleted_at: null,
      created_at: "2026-03-06T00:00:00.000Z",
    },
    {
      id: "alumni-dylan",
      organization_id: ORG_ID,
      user_id: "user-dylan",
      first_name: "Dylan",
      last_name: "Burak",
      email: "dylan@example.com",
      major: null,
      current_company: "Wharton Sports Group",
      industry: "Sports",
      current_city: "Philadelphia",
      graduation_year: 2025,
      position_title: "Advisor",
      job_title: null,
      deleted_at: null,
      created_at: "2026-03-07T00:00:00.000Z",
    },
    {
      id: "alumni-aarav",
      organization_id: ORG_ID,
      user_id: "user-aarav",
      first_name: "Aarav",
      last_name: "Doshi",
      email: "aarav@example.com",
      major: null,
      current_company: "Penn Athletics",
      industry: "Sports",
      current_city: "Philadelphia",
      graduation_year: 2022,
      position_title: "Mentor",
      job_title: null,
      deleted_at: null,
      created_at: "2026-03-08T00:00:00.000Z",
    },
    {
      id: "alumni-alex",
      organization_id: ORG_ID,
      user_id: "user-alex",
      first_name: "Alex",
      last_name: "Gonzalez",
      email: "alex@example.com",
      major: null,
      current_company: "Goldman Sachs",
      industry: "Finance",
      current_city: "New York",
      graduation_year: 2028,
      position_title: "Mentor",
      job_title: null,
      deleted_at: null,
      created_at: "2026-03-09T00:00:00.000Z",
    },
  ]);

  const [louis, matt, matthew] = await Promise.all([
    suggestConnections({
      orgId: ORG_ID,
      serviceSupabase: stub as any,
      args: { person_query: "Louis Ciccone" },
    }),
    suggestConnections({
      orgId: ORG_ID,
      serviceSupabase: stub as any,
      args: { person_query: "Matt Leonard" },
    }),
    suggestConnections({
      orgId: ORG_ID,
      serviceSupabase: stub as any,
      args: { person_query: "Matthew McKilloop" },
    }),
  ]);

  const louisNames = louis.suggestions.map((row) => row.name);
  const mattNames = matt.suggestions.map((row) => row.name);
  const matthewNames = matthew.suggestions.map((row) => row.name);

  assert.notDeepEqual(louisNames, mattNames);
  assert.notDeepEqual(louisNames, matthewNames);
  assert.notDeepEqual(mattNames, matthewNames);

  assert.equal(
    louis.suggestions.some((row) => row.reasons.some((reason) => reason.code === "shared_company")),
    false
  );
  assert.equal(
    matt.suggestions.some((row) => row.reasons.some((reason) => reason.code === "shared_company")),
    false
  );
  assert.equal(
    matthew.suggestions.some((row) =>
      row.reasons.some((reason) => reason.code === "shared_company")
    ),
    false
  );
});

test("suggestConnections returns weak fallback matches for sparse member profiles", async () => {
  const stub = createSupabaseStub();

  stub.seed("members", [
    {
      id: "member-source",
      organization_id: ORG_ID,
      user_id: "source-user",
      deleted_at: null,
      status: "active",
      first_name: "Louis",
      last_name: "Ciccone",
      email: "louis@example.com",
      role: "Captain",
      current_company: null,
      graduation_year: 2024,
      created_at: "2026-03-01T00:00:00.000Z",
    },
    {
      id: "member-match",
      organization_id: ORG_ID,
      user_id: "match-user",
      deleted_at: null,
      status: "active",
      first_name: "Dana",
      last_name: "Coach",
      email: "dana@example.com",
      role: "Coach",
      current_company: null,
      graduation_year: 2026,
      created_at: "2026-03-02T00:00:00.000Z",
    },
  ]);

  stub.seed("alumni", [
    {
      id: "alumni-source",
      organization_id: ORG_ID,
      user_id: "source-user",
      first_name: "Louis",
      last_name: "Ciccone",
      email: "louis@example.com",
      major: null,
      current_company: null,
      industry: null,
      current_city: "Philadelphia",
      graduation_year: 2024,
      position_title: null,
      job_title: null,
      deleted_at: null,
      created_at: "2026-03-03T00:00:00.000Z",
    },
    {
      id: "alumni-match",
      organization_id: ORG_ID,
      user_id: "match-user",
      first_name: "Dana",
      last_name: "Coach",
      email: "dana@example.com",
      major: null,
      current_company: null,
      industry: null,
      current_city: "Philadelphia",
      graduation_year: 2026,
      position_title: "Advisor",
      job_title: null,
      deleted_at: null,
      created_at: "2026-03-04T00:00:00.000Z",
    },
  ]);

  const result = await suggestConnections({
    orgId: ORG_ID,
    serviceSupabase: stub as any,
    args: {
      person_type: "member",
      person_id: "member-source",
    },
  });

  assert.equal(result.state, "resolved");
  assert.equal(result.source_person?.name, "Louis Ciccone");
  assert.deepEqual(
    result.suggestions.map((row) => row.name),
    ["Dana Coach"]
  );
  assert.deepEqual(
    result.suggestions[0]?.reasons.map((reason) => reason.code),
    ["shared_city", "graduation_proximity"]
  );
});

test("scoreProjectedCandidates prefers shared role family over weak support only", () => {
  const source = makeProjectedPerson({
    personKey: "user:source",
    personId: "source",
    name: "Source Person",
    roleFamily: "Engineering",
    graduationYear: 2026,
    currentCity: "Philadelphia",
  });
  const roleFamilyMatch = makeProjectedPerson({
    personKey: "user:role-family",
    personId: "role-family",
    name: "Engineer Match",
    roleFamily: "Engineering",
  });
  const weakOnlyMatch = makeProjectedPerson({
    personKey: "user:weak-only",
    personId: "weak-only",
    name: "Weak Match",
    currentCity: "Philadelphia",
    graduationYear: 2027,
  });

  const suggestions = scoreProjectedCandidates({
    source,
    allPeople: [source, roleFamilyMatch, weakOnlyMatch],
    candidates: [roleFamilyMatch, weakOnlyMatch],
    limit: 3,
  });

  assert.deepEqual(
    suggestions.map((row) => row.name),
    ["Engineer Match"]
  );
  assert.deepEqual(
    suggestions[0].reasons.map((reason) => reason.code),
    ["shared_role_family"]
  );
});

test("scoreProjectedCandidates falls back to weak support when no professional matches exist", () => {
  const source = makeProjectedPerson({
    personKey: "user:source",
    personId: "source",
    name: "Source Person",
    graduationYear: 2026,
    currentCity: "Philadelphia",
  });
  const weakOnlyMatch = makeProjectedPerson({
    personKey: "user:weak-only",
    personId: "weak-only",
    name: "Weak Match",
    currentCity: "Philadelphia",
    graduationYear: 2027,
  });

  const suggestions = scoreProjectedCandidates({
    source,
    allPeople: [source, weakOnlyMatch],
    candidates: [weakOnlyMatch],
    limit: 3,
  });

  assert.deepEqual(
    suggestions.map((row) => row.name),
    ["Weak Match"]
  );
  assert.deepEqual(
    suggestions[0].reasons.map((reason) => reason.code),
    ["shared_city", "graduation_proximity"]
  );
});

test("buildCandidatePool keeps adjacent role families out of the professional overflow bucket", () => {
  const source = makeProjectedPerson({
    personKey: "user:source",
    personId: "source",
    name: "Source Person",
    roleFamily: "Engineering",
    currentCity: "Philadelphia",
  });
  const adjacentCandidate = makeProjectedPerson({
    personKey: "user:adjacent",
    personId: "adjacent",
    name: "Adjacent Candidate",
    roleFamily: "Data",
    currentCity: "Philadelphia",
  });
  const professionalCandidates = Array.from({ length: 5 }, (_, index) =>
    makeProjectedPerson({
      personKey: `user:professional-${index + 1}`,
      personId: `professional-${index + 1}`,
      name: `Professional ${index + 1}`,
      roleFamily: "Engineering",
    })
  );

  const pool = buildCandidatePool({
    source,
    candidates: [...professionalCandidates, adjacentCandidate],
    limit: 1,
  });

  assert.equal(pool.length, 5);
  assert.equal(
    pool.some((entry) => entry.candidate.personId === "adjacent"),
    false
  );

  const suggestions = scoreProjectedCandidates({
    source,
    allPeople: [source, ...professionalCandidates, adjacentCandidate],
    candidates: [...professionalCandidates, adjacentCandidate],
    limit: 3,
  });

  assert.equal(
    suggestions.some((entry) => entry.name === "Adjacent Candidate"),
    false
  );
});

test("scoreProjectedCandidates boosts rarer role-family matches ahead of common ones", () => {
  const source = makeProjectedPerson({
    personKey: "user:source",
    personId: "source",
    name: "Source Person",
    roleFamily: "Engineering",
  });
  const rareEngineeringMatch = makeProjectedPerson({
    personKey: "user:rare",
    personId: "rare",
    name: "Rare Engineer",
    roleFamily: "Engineering",
  });
  const commonFinanceMatch = makeProjectedPerson({
    personKey: "user:finance-1",
    personId: "finance-1",
    name: "Finance One",
    roleFamily: "Finance",
  });
  const commonFinanceTwo = makeProjectedPerson({
    personKey: "user:finance-2",
    personId: "finance-2",
    name: "Finance Two",
    roleFamily: "Finance",
  });
  const commonFinanceThree = makeProjectedPerson({
    personKey: "user:finance-3",
    personId: "finance-3",
    name: "Finance Three",
    roleFamily: "Finance",
  });
  const fillerPeople = Array.from({ length: 5 }, (_, index) =>
    makeProjectedPerson({
      personKey: `user:filler-${index + 1}`,
      personId: `filler-${index + 1}`,
      name: `Filler ${index + 1}`,
    })
  );

  const suggestions = scoreProjectedCandidates({
    source,
    allPeople: [
      source,
      rareEngineeringMatch,
      commonFinanceMatch,
      commonFinanceTwo,
      commonFinanceThree,
      ...fillerPeople,
    ],
    candidates: [rareEngineeringMatch, commonFinanceMatch],
    limit: 3,
  });

  assert.equal(suggestions[0].name, "Rare Engineer");
  assert.equal(
    suggestions[0].reasons.find((reason) => reason.code === "shared_role_family")?.weight,
    25
  );
});

test("scoreProjectedCandidates applies exposure penalty without changing returned reasons", () => {
  const telemetryOrgId = "22222222-2222-2222-2222-222222222222";
  const source = makeProjectedPerson({
    orgId: telemetryOrgId,
    personKey: "user:source",
    personId: "source",
    name: "Source Person",
    industry: "Technology",
    roleFamily: "Engineering",
  });
  const overexposed = makeProjectedPerson({
    orgId: telemetryOrgId,
    personKey: "user:overexposed",
    personId: "overexposed",
    name: "Overexposed Candidate",
    industry: "Technology",
    roleFamily: "Engineering",
  });
  const fresh = makeProjectedPerson({
    orgId: telemetryOrgId,
    personKey: "user:fresh",
    personId: "fresh",
    name: "Fresh Candidate",
    industry: "Technology",
    roleFamily: "Engineering",
  });

  for (let index = 0; index < 10; index += 1) {
    recordSuggestedCandidates({
      orgId: telemetryOrgId,
      personIds: ["overexposed", `x${index * 2 + 1}`, `x${index * 2 + 2}`],
    });
  }

  const suggestions = scoreProjectedCandidates({
    source,
    allPeople: [source, overexposed, fresh],
    candidates: [overexposed, fresh],
    limit: 3,
  });

  assert.equal(suggestions[0].name, "Fresh Candidate");
  assert.deepEqual(
    suggestions
      .find((row) => row.name === "Overexposed Candidate")
      ?.reasons.map((reason) => reason.code),
    ["shared_industry", "shared_role_family"]
  );
});

test("scoreProjectedCandidates clamps scores at zero when exposure exceeds reason weight", () => {
  const telemetryOrgId = "33333333-3333-3333-3333-333333333333";
  const source = makeProjectedPerson({
    orgId: telemetryOrgId,
    personKey: "user:source",
    personId: "source",
    name: "Source Person",
    roleFamily: "Engineering",
  });
  const overexposed = makeProjectedPerson({
    orgId: telemetryOrgId,
    personKey: "user:overexposed",
    personId: "overexposed",
    name: "Overexposed Candidate",
    roleFamily: "Engineering",
  });
  const fillerOne = makeProjectedPerson({
    orgId: telemetryOrgId,
    personKey: "user:filler-1",
    personId: "filler-1",
    name: "Filler One",
    roleFamily: "Engineering",
  });
  const fillerTwo = makeProjectedPerson({
    orgId: telemetryOrgId,
    personKey: "user:filler-2",
    personId: "filler-2",
    name: "Filler Two",
    roleFamily: "Engineering",
  });

  for (let index = 0; index < 10; index += 1) {
    recordSuggestedCandidates({
      orgId: telemetryOrgId,
      personIds: ["overexposed", `role-${index * 2 + 1}`, `role-${index * 2 + 2}`],
    });
  }

  const suggestions = scoreProjectedCandidates({
    source,
    allPeople: [source, overexposed, fillerOne, fillerTwo],
    candidates: [overexposed],
    limit: 3,
  });

  assert.equal(suggestions[0]?.score, 0);
  assert.deepEqual(
    suggestions[0]?.reasons.map((reason) => reason.code),
    ["shared_role_family"]
  );
});

test("buildProjectedPeople emits exactly one org-scoped canonical user:* identity for linked member and alumni", () => {
  const projected = buildProjectedPeople({
    members: [
      {
        id: "m-linked",
        organization_id: ORG_ID,
        user_id: "uid-linked",
        deleted_at: null,
        status: "active",
        first_name: "Jordan",
        last_name: "Linked",
        email: "jordan@example.com",
        role: "Secretary",
        current_company: "MemberCo",
        graduation_year: 2024,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    alumni: [
      {
        id: "a-linked",
        organization_id: ORG_ID,
        user_id: "uid-linked",
        deleted_at: null,
        first_name: "Jordan",
        last_name: "Linked",
        email: "jordan@example.com",
        major: "Business",
        current_company: "AlumniCo",
        industry: "Finance",
        current_city: "Denver",
        graduation_year: 2021,
        position_title: "Partner",
        job_title: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  });

  // Exactly ONE canonical identity (no standalone member: or alumni: keys)
  assert.equal(projected.size, 1);

  // The Map key must include the orgId for strict org scoping
  const canonicalKey = `${ORG_ID}:user:uid-linked`;
  assert.ok(projected.has(canonicalKey), `expected Map key '${canonicalKey}' to exist`);

  // No standalone keys for the linked rows
  assert.ok(
    !projected.has(`${ORG_ID}:member:m-linked`),
    "linked member must not get a standalone key"
  );
  assert.ok(
    !projected.has(`${ORG_ID}:alumni:a-linked`),
    "linked alumni must not get a standalone key"
  );

  const person = projected.get(canonicalKey);
  assert.ok(person, "canonical person must be defined");
  assert.equal(person?.userId, "uid-linked");
  assert.equal(person?.memberId, "m-linked");
  assert.equal(person?.alumniId, "a-linked");
  assert.equal(person?.personKey, "user:uid-linked");
  assert.equal(person?.orgId, ORG_ID);
});

test("buildProjectedPeople deterministic attribute precedence: alumni fields take priority over member for role/company/graduationYear", () => {
  const projected = buildProjectedPeople({
    members: [
      {
        id: "m-prec",
        organization_id: ORG_ID,
        user_id: "uid-prec",
        deleted_at: null,
        status: "active",
        first_name: "Robin",
        last_name: "Precedence",
        email: "robin@example.com",
        role: "Treasurer",
        current_company: "MemberCorp",
        graduation_year: 2026,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    alumni: [
      {
        id: "a-prec",
        organization_id: ORG_ID,
        user_id: "uid-prec",
        deleted_at: null,
        first_name: "Robin",
        last_name: "Precedence",
        email: "robin@example.com",
        major: "Economics",
        current_company: "AlumniCorp",
        industry: "Banking",
        current_city: "Seattle",
        graduation_year: 2019,
        position_title: "Director",
        job_title: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  });

  const person = projected.get(`${ORG_ID}:user:uid-prec`);
  assert.ok(person, "merged person must exist");

  // Alumni position_title beats member role
  assert.equal(
    person?.role,
    "Director",
    "alumni position_title must take precedence over member role"
  );
  // Alumni current_company beats member current_company
  assert.equal(person?.currentCompany, "AlumniCorp", "alumni current_company must take precedence");
  // Alumni graduation_year beats member graduation_year
  assert.equal(person?.graduationYear, 2019, "alumni graduation_year must take precedence");
  // Alumni-only fields preserved
  assert.equal(person?.major, "Economics");
  assert.equal(person?.industry, "Finance");
  assert.equal(person?.currentCity, "Seattle");
  // personType is "member" when a member row is present
  assert.equal(person?.personType, "member");
});

test("buildSourcePerson returns person with org-scoped personKey matching buildProjectedPeople for linked rows", () => {
  const memberRow = {
    id: "m-parity",
    organization_id: ORG_ID,
    user_id: "uid-parity",
    deleted_at: null,
    status: "active",
    first_name: "Casey",
    last_name: "Parity",
    email: "casey@example.com",
    role: "VP",
    current_company: "Acme",
    graduation_year: 2023,
    created_at: "2026-02-01T00:00:00.000Z",
  };
  const alumniRow = {
    id: "a-parity",
    organization_id: ORG_ID,
    user_id: "uid-parity",
    deleted_at: null,
    first_name: "Casey",
    last_name: "Parity",
    email: "casey@example.com",
    major: "CS",
    current_company: "Acme",
    industry: "Tech",
    current_city: "NYC",
    graduation_year: 2020,
    position_title: "CTO",
    job_title: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  const fromBuild = buildSourcePerson({ memberRows: [memberRow], alumniRows: [alumniRow] });
  const fromProjection = buildProjectedPeople({ members: [memberRow], alumni: [alumniRow] });

  // buildSourcePerson must return the same object as buildProjectedPeople's value for the canonical key
  assert.deepEqual(fromBuild, fromProjection.get(`${ORG_ID}:user:uid-parity`));
});

// ---------------------------------------------------------------------------
// VAL-IDENTITY-004: Strict org isolation — same user_id never merges across orgs
// ---------------------------------------------------------------------------

const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-000000000002";

test("buildProjectedPeople strict org isolation: same user_id across two orgs produces two separate canonical identities", () => {
  const projected = buildProjectedPeople({
    members: [
      {
        id: "m-orga",
        organization_id: ORG_A,
        user_id: "shared-uid",
        deleted_at: null,
        status: "active",
        first_name: "Alex",
        last_name: "OrgA",
        email: "alex@orga.com",
        role: "Admin",
        current_company: "OrgACo",
        graduation_year: 2022,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "m-orgb",
        organization_id: ORG_B,
        user_id: "shared-uid",
        deleted_at: null,
        status: "active",
        first_name: "Alex",
        last_name: "OrgB",
        email: "alex@orgb.com",
        role: "Member",
        current_company: "OrgBCo",
        graduation_year: 2022,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    alumni: [],
  });

  // Must produce two separate entries — one per org — not a single merged identity
  assert.equal(
    projected.size,
    2,
    "same user_id in two orgs must produce 2 separate entries, not 1 merged"
  );

  const orgAKey = `${ORG_A}:user:shared-uid`;
  const orgBKey = `${ORG_B}:user:shared-uid`;

  assert.ok(projected.has(orgAKey), `ORG_A entry with key '${orgAKey}' must exist`);
  assert.ok(projected.has(orgBKey), `ORG_B entry with key '${orgBKey}' must exist`);

  // Each org's canonical person must carry the correct orgId and memberId
  const personA = projected.get(orgAKey);
  const personB = projected.get(orgBKey);

  assert.equal(personA?.orgId, ORG_A, "ORG_A person must have orgId=ORG_A");
  assert.equal(personB?.orgId, ORG_B, "ORG_B person must have orgId=ORG_B");
  assert.equal(personA?.memberId, "m-orga");
  assert.equal(personB?.memberId, "m-orgb");

  // The personKey field stored in the node stays as user:shared-uid (no org prefix in the projected node attribute)
  assert.equal(personA?.personKey, "user:shared-uid");
  assert.equal(personB?.personKey, "user:shared-uid");
});

test("buildProjectedPeople org isolation: member and alumni from different orgs sharing user_id stay separate", () => {
  const projected = buildProjectedPeople({
    members: [
      {
        id: "m-a",
        organization_id: ORG_A,
        user_id: "cross-uid",
        deleted_at: null,
        status: "active",
        first_name: "Pat",
        last_name: "Cross",
        email: "pat@a.com",
        role: null,
        current_company: null,
        graduation_year: null,
        created_at: null,
      },
    ],
    alumni: [
      {
        id: "al-b",
        organization_id: ORG_B,
        user_id: "cross-uid",
        deleted_at: null,
        first_name: "Pat",
        last_name: "Cross",
        email: "pat@b.com",
        major: null,
        current_company: null,
        industry: null,
        current_city: null,
        graduation_year: null,
        position_title: null,
        job_title: null,
        created_at: null,
      },
    ],
  });

  // Member from ORG_A and alumni from ORG_B must NOT merge even though they share user_id
  assert.equal(
    projected.size,
    2,
    "cross-org member+alumni with shared user_id must remain separate"
  );

  const orgAKey = `${ORG_A}:user:cross-uid`;
  const orgBKey = `${ORG_B}:user:cross-uid`;

  assert.ok(projected.has(orgAKey), "ORG_A member entry must exist");
  assert.ok(projected.has(orgBKey), "ORG_B alumni entry must exist");

  // ORG_A entry is member-only (no alumniId from ORG_B)
  const personA = projected.get(orgAKey);
  assert.equal(personA?.orgId, ORG_A);
  assert.equal(personA?.memberId, "m-a");
  assert.equal(personA?.alumniId, null, "ORG_A person must not have alumniId from a different org");

  // ORG_B entry is alumni-only (no memberId from ORG_A)
  const personB = projected.get(orgBKey);
  assert.equal(personB?.orgId, ORG_B);
  assert.equal(personB?.alumniId, "al-b");
  assert.equal(personB?.memberId, null, "ORG_B person must not have memberId from a different org");
});
