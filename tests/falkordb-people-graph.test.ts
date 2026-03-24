/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import { buildProjectedPeople, buildSourcePerson } from "../src/lib/falkordb/people.ts";
import { suggestConnections } from "../src/lib/falkordb/suggestions.ts";
import { processGraphSyncQueue } from "../src/lib/falkordb/sync.ts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

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

  stub.registerRpc("get_mentorship_distances", () => [
    {
      user_id: "00000000-0000-0000-0000-000000000002",
      distance: 1,
    },
    {
      user_id: "00000000-0000-0000-0000-000000000003",
      distance: 2,
    },
  ]);
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
  assert.deepEqual(projected.get("user:shared-user"), {
    orgId: ORG_ID,
    personKey: "user:shared-user",
    personType: "member",
    personId: "member-1",
    memberId: "member-1",
    alumniId: "alumni-1",
    userId: "shared-user",
    name: "Mia Member",
    role: "Engineer",
    major: "Computer Science",
    currentCompany: "Acme",
    industry: "Technology",
    graduationYear: 2023,
    currentCity: "Austin",
  });
  assert.ok(projected.has("member:member-2"));
  assert.ok(projected.has("alumni:alumni-2"));
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

  assert.deepEqual(fromBuild, fromProjection.get("user:shared-user"));
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

  assert.deepEqual(fromBuild, fromProjection.get("member:member-solo"));
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

  assert.deepEqual(fromBuild, fromProjection.get("alumni:alumni-solo"));
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

  assert.deepEqual(fromBuild, fromProjection.get("user:shared-user"));
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
    graphClient: {
      isAvailable: () => false,
      query: async () => [],
    },
  });

  assert.equal(result.mode, "sql_fallback");
  assert.equal(result.freshness.state, "fresh");
  assert.deepEqual(
    result.results.map((row) => ({
      name: row.name,
      score: row.score,
      reasonCodes: row.reasons.map((reason) => reason.code),
    })),
    [
      {
        name: "Dina Direct",
        score: 128,
        reasonCodes: ["direct_mentorship", "shared_company", "shared_graduation_year"],
      },
      {
        name: "Sam Second",
        score: 77,
        reasonCodes: ["second_degree_mentorship", "shared_industry", "shared_major", "shared_city"],
      },
      {
        name: "Ava Attribute",
        score: 55,
        reasonCodes: [
          "shared_company",
          "shared_industry",
          "shared_major",
          "shared_graduation_year",
          "shared_city",
        ],
      },
    ]
  );
});

test("suggestConnections graph mode matches SQL fallback ordering and reasons", async () => {
  const stub = createSupabaseStub();
  seedSuggestionFixture(stub);

  const candidateRows = [
    {
      personKey: "user:00000000-0000-0000-0000-000000000002",
      personType: "alumni",
      personId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
      name: "Dina Direct",
      userId: "00000000-0000-0000-0000-000000000002",
      role: "VP Product",
      major: null,
      currentCompany: "Acme",
      industry: null,
      graduationYear: 2018,
      currentCity: null,
    },
    {
      personKey: "user:00000000-0000-0000-0000-000000000003",
      personType: "alumni",
      personId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3",
      name: "Sam Second",
      userId: "00000000-0000-0000-0000-000000000003",
      role: "Founder",
      major: "Computer Science",
      currentCompany: null,
      industry: "Technology",
      graduationYear: null,
      currentCity: "Austin",
    },
    {
      personKey: "user:00000000-0000-0000-0000-000000000004",
      personType: "alumni",
      personId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4",
      name: "Ava Attribute",
      userId: "00000000-0000-0000-0000-000000000004",
      role: "Investor",
      major: "Computer Science",
      currentCompany: "Acme",
      industry: "Technology",
      graduationYear: 2018,
      currentCity: "Austin",
    },
    {
      personKey: "user:00000000-0000-0000-0000-000000000005",
      personType: "alumni",
      personId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5",
      name: "Nora Sparse",
      userId: "00000000-0000-0000-0000-000000000005",
      role: null,
      major: null,
      currentCompany: null,
      industry: null,
      graduationYear: null,
      currentCity: null,
    },
  ];

  const distanceRows = [
    { personKey: "user:00000000-0000-0000-0000-000000000002", distance: 1 },
    { personKey: "user:00000000-0000-0000-0000-000000000003", distance: 2 },
  ];

  const graphClient = {
    isAvailable: () => true,
    query: async (_orgId: string, cypher: string) => {
      if (cypher.includes("RETURN source.personKey AS personKey")) {
        return [{ personKey: "user:00000000-0000-0000-0000-000000000001" }];
      }
      if (cypher.includes("shortestPath")) {
        return distanceRows;
      }
      return candidateRows;
    },
  };

  const graphResult = await suggestConnections({
    orgId: ORG_ID,
    serviceSupabase: stub as any,
    args: {
      person_type: "alumni",
      person_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
    },
    graphClient,
  });

  const fallbackResult = await suggestConnections({
    orgId: ORG_ID,
    serviceSupabase: stub as any,
    args: {
      person_type: "alumni",
      person_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
    },
    graphClient: {
      isAvailable: () => false,
      query: async () => [],
    },
  });

  assert.equal(graphResult.mode, "falkor");
  assert.deepEqual(graphResult.results, fallbackResult.results);
});

test("suggestConnections graph mode preserves merged source attributes with duplicate complement rows", async () => {
  const stub = createSupabaseStub();

  stub.seed("alumni", [
    {
      id: "source-alumni",
      organization_id: ORG_ID,
      user_id: "source-user",
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
      deleted_at: null,
      created_at: "2026-03-03T00:00:00.000Z",
    },
  ]);

  stub.seed("members", [
    {
      id: "member-newer",
      organization_id: ORG_ID,
      user_id: "source-user",
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
      user_id: "source-user",
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
  ]);

  const graphClient = {
    isAvailable: () => true,
    query: async (_orgId: string, cypher: string) => {
      if (cypher.includes("RETURN source.personKey AS personKey")) {
        return [{ personKey: "user:source-user" }];
      }
      if (cypher.includes("shortestPath")) {
        return [];
      }
      return [
        {
          personKey: "user:candidate-user",
          personType: "alumni",
          personId: "candidate-alumni",
          name: "Casey Candidate",
          userId: "candidate-user",
          role: "Engineer",
          major: null,
          currentCompany: "Acme",
          industry: null,
          graduationYear: 2024,
          currentCity: null,
        },
      ];
    },
  };

  const result = await suggestConnections({
    orgId: ORG_ID,
    serviceSupabase: stub as any,
    args: {
      person_type: "alumni",
      person_id: "source-alumni",
    },
    graphClient,
  });

  assert.equal(result.mode, "falkor");
  assert.deepEqual(result.results, [
    {
      person_type: "alumni",
      person_id: "candidate-alumni",
      name: "Casey Candidate",
      score: 28,
      preview: {
        role: "Engineer",
        current_company: "Acme",
        graduation_year: 2024,
      },
      reasons: [
        {
          code: "shared_company",
          weight: 20,
          value: "Acme",
        },
        {
          code: "shared_graduation_year",
          weight: 8,
          value: 2024,
        },
      ],
    },
  ]);
});

test("processGraphSyncQueue merges shared-user people and syncs mentorship edges", async () => {
  const stub = createSupabaseStub();

  stub.seed("members", [
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
      organization_id: ORG_ID,
      user_id: "00000000-0000-0000-0000-000000000010",
      status: "active",
      first_name: "Morgan",
      last_name: "Member",
      email: "morgan@example.com",
      role: "President",
      current_company: "Acme",
      graduation_year: 2025,
      deleted_at: null,
    },
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2",
      organization_id: ORG_ID,
      user_id: "00000000-0000-0000-0000-000000000011",
      status: "active",
      first_name: "Taylor",
      last_name: "Mentee",
      email: "taylor@example.com",
      role: "Vice President",
      current_company: "Beta",
      graduation_year: 2026,
      deleted_at: null,
    },
  ]);
  stub.seed("alumni", [
    {
      id: "cccccccc-cccc-cccc-cccc-ccccccccccc1",
      organization_id: ORG_ID,
      user_id: "00000000-0000-0000-0000-000000000010",
      first_name: "Morgan",
      last_name: "Alumni",
      email: "morgan@example.com",
      major: "Economics",
      current_company: "Acme",
      industry: "Finance",
      current_city: "Chicago",
      graduation_year: 2023,
      position_title: "Analyst",
      job_title: null,
      deleted_at: null,
    },
  ]);
  stub.seed("mentorship_pairs", [
    {
      id: "dddddddd-dddd-dddd-dddd-ddddddddddd1",
      organization_id: ORG_ID,
      mentor_user_id: "00000000-0000-0000-0000-000000000010",
      mentee_user_id: "00000000-0000-0000-0000-000000000011",
      status: "active",
      deleted_at: null,
    },
  ]);

  const queueItems = [
    {
      id: "queue-1",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
      action: "upsert",
      payload: {},
    },
    {
      id: "queue-2",
      org_id: ORG_ID,
      source_table: "alumni",
      source_id: "cccccccc-cccc-cccc-cccc-ccccccccccc1",
      action: "upsert",
      payload: {},
    },
    {
      id: "queue-3",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2",
      action: "upsert",
      payload: {},
    },
    {
      id: "queue-4",
      org_id: ORG_ID,
      source_table: "mentorship_pairs",
      source_id: "dddddddd-dddd-dddd-dddd-ddddddddddd1",
      action: "upsert",
      payload: {},
    },
  ];

  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  stub.registerRpc("dequeue_graph_sync_queue", () => queueItems);
  stub.registerRpc("increment_graph_sync_attempts", () => null);

  const graphCalls: Array<{ cypher: string; params?: Record<string, unknown> }> = [];
  const graphClient = {
    isAvailable: () => true,
    query: async (_orgId: string, cypher: string, params?: Record<string, unknown>) => {
      graphCalls.push({ cypher, params });
      return [];
    },
  };

  const originalRpc = stub.rpc;
  (stub as any).rpc = async (name: string, params: Record<string, unknown> = {}) => {
    rpcCalls.push({ name, params });
    return originalRpc(name, params);
  };

  const stats = await processGraphSyncQueue(stub as any, {
    graphClient,
  });

  assert.deepEqual(stats, { processed: 4, skipped: 0, failed: 0 });
  const mergedNodeCall = graphCalls.find(
    (call) =>
      call.cypher.includes("SET person = $props") &&
      call.params?.personKey === "user:00000000-0000-0000-0000-000000000010"
  );
  assert.ok(mergedNodeCall);
  assert.equal(mergedNodeCall?.params?.props?.memberId, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1");
  assert.equal(mergedNodeCall?.params?.props?.alumniId, "cccccccc-cccc-cccc-cccc-ccccccccccc1");

  const mentorshipEdgeCall = graphCalls.find((call) => call.cypher.includes("MERGE (mentor)-[:MENTORS]->(mentee)"));
  assert.ok(mentorshipEdgeCall);
  assert.equal(mentorshipEdgeCall?.params?.mentorKey, "user:00000000-0000-0000-0000-000000000010");
  assert.equal(mentorshipEdgeCall?.params?.menteeKey, "user:00000000-0000-0000-0000-000000000011");
  assert.equal(rpcCalls.some((call) => call.name === "increment_graph_sync_attempts"), false);
});
