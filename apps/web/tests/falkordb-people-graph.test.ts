/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import {
  buildProjectedPeople,
  buildSourcePerson,
  type ProjectedPerson,
} from "../src/lib/falkordb/people.ts";
import {
  buildCandidatePool,
  getSuggestionObservabilityByOrg,
  scoreProjectedCandidates,
  suggestConnections,
} from "../src/lib/falkordb/suggestions.ts";
import { getGraphHealthSurface, processGraphSyncQueue } from "../src/lib/falkordb/sync.ts";
import {
  recordSuggestedCandidates,
  resetFalkorTelemetryForTests,
} from "../src/lib/falkordb/telemetry.ts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  resetFalkorTelemetryForTests();
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

function makeProjectedPerson(overrides: Partial<ProjectedPerson> & Pick<ProjectedPerson, "personKey" | "personId" | "name">): ProjectedPerson {
  return {
    orgId: overrides.orgId ?? ORG_ID,
    personKey: overrides.personKey,
    personType: overrides.personType ?? "alumni",
    personId: overrides.personId,
    memberId: overrides.memberId ?? null,
    alumniId: overrides.alumniId ?? overrides.personId,
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
  };
}

function createInMemoryGraphClient() {
  const graphs = new Map<
    string,
    {
      nodes: Map<string, Record<string, unknown>>;
      edges: Set<string>;
    }
  >();

  function ensureGraph(orgId: string) {
    const existing = graphs.get(orgId);
    if (existing) {
      return existing;
    }

    const created = {
      nodes: new Map<string, Record<string, unknown>>(),
      edges: new Set<string>(),
    };
    graphs.set(orgId, created);
    return created;
  }

  function edgeKey(from: string, to: string) {
    return `${from}->${to}`;
  }

  function incomingEdges(graph: ReturnType<typeof ensureGraph>, personKey: string) {
    return [...graph.edges]
      .filter((entry) => entry.endsWith(`->${personKey}`))
      .map((entry) => entry.split("->")[0]);
  }

  function outgoingEdges(graph: ReturnType<typeof ensureGraph>, personKey: string) {
    return [...graph.edges]
      .filter((entry) => entry.startsWith(`${personKey}->`))
      .map((entry) => entry.split("->")[1]);
  }

  function secondDegree(graph: ReturnType<typeof ensureGraph>, sourceKey: string, shape: string) {
    const distances = new Set<string>();

    if (shape === "out-out") {
      for (const middle of outgoingEdges(graph, sourceKey)) {
        for (const target of outgoingEdges(graph, middle)) {
          if (target !== sourceKey) distances.add(target);
        }
      }
    } else if (shape === "in-in") {
      for (const middle of incomingEdges(graph, sourceKey)) {
        for (const target of incomingEdges(graph, middle)) {
          if (target !== sourceKey) distances.add(target);
        }
      }
    } else if (shape === "in-out") {
      for (const middle of incomingEdges(graph, sourceKey)) {
        for (const target of outgoingEdges(graph, middle)) {
          if (target !== sourceKey) distances.add(target);
        }
      }
    } else if (shape === "out-in") {
      for (const middle of outgoingEdges(graph, sourceKey)) {
        for (const target of incomingEdges(graph, middle)) {
          if (target !== sourceKey) distances.add(target);
        }
      }
    }

    return [...distances].map((personKey) => ({ personKey, distance: 2 }));
  }

  return {
    isAvailable: () => true,
    seedNode(orgId: string, node: Record<string, unknown>) {
      ensureGraph(orgId).nodes.set(String(node.personKey), { ...node });
    },
    seedEdge(orgId: string, from: string, to: string) {
      ensureGraph(orgId).edges.add(edgeKey(from, to));
    },
    snapshot(orgId: string) {
      const graph = ensureGraph(orgId);
      return {
        nodes: [...graph.nodes.values()].map((node) => ({ ...node })),
        edges: [...graph.edges.values()].sort(),
      };
    },
    async query(orgId: string, cypher: string, params?: Record<string, unknown>) {
      const graph = ensureGraph(orgId);

      if (cypher.includes("DETACH DELETE person")) {
        const personKey = String(params?.personKey);
        graph.nodes.delete(personKey);
        for (const edge of [...graph.edges]) {
          if (edge.startsWith(`${personKey}->`) || edge.endsWith(`->${personKey}`)) {
            graph.edges.delete(edge);
          }
        }
        return [];
      }

      if (cypher.includes("SET person = $props")) {
        graph.nodes.set(String(params?.personKey), { ...(params?.props as Record<string, unknown>) });
        return [];
      }

      if (cypher.includes("MERGE (mentor)-[:MENTORS]->(mentee)")) {
        const mentorKey = String(params?.mentorKey);
        const menteeKey = String(params?.menteeKey);
        if (graph.nodes.has(mentorKey) && graph.nodes.has(menteeKey)) {
          graph.edges.add(edgeKey(mentorKey, menteeKey));
        }
        return [];
      }

      if (cypher.includes("DELETE edge")) {
        graph.edges.delete(edgeKey(String(params?.mentorKey), String(params?.menteeKey)));
        return [];
      }

      if (cypher.includes("candidate.personKey AS personKey") && !cypher.includes(" AS distance")) {
        return [...graph.nodes.values()] as Array<Record<string, unknown>>;
      }

      const sourceKey = String(params?.sourceKey);
      if (cypher.includes(")-[:MENTORS]->(candidate:Person)") && !cypher.includes("(:Person)-[:MENTORS]->")) {
        return outgoingEdges(graph, sourceKey)
          .filter((personKey) => personKey !== sourceKey)
          .map((personKey) => ({ personKey, distance: 1 }));
      }
      if (cypher.includes(")<-[:MENTORS]-(candidate:Person)") && !cypher.includes("(:Person)<-[:MENTORS]-")) {
        return incomingEdges(graph, sourceKey)
          .filter((personKey) => personKey !== sourceKey)
          .map((personKey) => ({ personKey, distance: 1 }));
      }
      if (cypher.includes(")-[:MENTORS]->(:Person)-[:MENTORS]->(candidate:Person)")) {
        return secondDegree(graph, sourceKey, "out-out");
      }
      if (cypher.includes(")<-[:MENTORS]-(:Person)<-[:MENTORS]-(candidate:Person)")) {
        return secondDegree(graph, sourceKey, "in-in");
      }
      if (cypher.includes(")<-[:MENTORS]-(:Person)-[:MENTORS]->(candidate:Person)")) {
        return secondDegree(graph, sourceKey, "in-out");
      }
      if (cypher.includes(")-[:MENTORS]->(:Person)<-[:MENTORS]-(candidate:Person)")) {
        return secondDegree(graph, sourceKey, "out-in");
      }

      return [];
    },
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
    graphClient: {
      isAvailable: () => false,
      query: async () => [],
    },
  });

  assert.equal(result.mode, "sql_fallback");
  assert.equal(result.fallback_reason, "unavailable");
  assert.equal(result.freshness.state, "unknown");
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
        reasonCodes: [
          "shared_industry",
          "shared_company",
          "shared_city",
          "graduation_proximity",
        ],
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

  const graphClient = {
    isAvailable: () => false,
    query: async () => [],
  };

  const [matthew, shorthand] = await Promise.all([
    suggestConnections({
      orgId: ORG_ID,
      serviceSupabase: stub as any,
      args: { person_query: "Matthew Leonard" },
      graphClient,
    }),
    suggestConnections({
      orgId: ORG_ID,
      serviceSupabase: stub as any,
      args: { person_query: "mat leo" },
      graphClient,
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

  const graphClient = {
    isAvailable: () => false,
    query: async () => [],
  };

  const [louis, matt, matthew] = await Promise.all([
    suggestConnections({
      orgId: ORG_ID,
      serviceSupabase: stub as any,
      args: { person_query: "Louis Ciccone" },
      graphClient,
    }),
    suggestConnections({
      orgId: ORG_ID,
      serviceSupabase: stub as any,
      args: { person_query: "Matt Leonard" },
      graphClient,
    }),
    suggestConnections({
      orgId: ORG_ID,
      serviceSupabase: stub as any,
      args: { person_query: "Matthew McKilloop" },
      graphClient,
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
    matthew.suggestions.some((row) => row.reasons.some((reason) => reason.code === "shared_company")),
    false
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

  const graphClient = {
    isAvailable: () => true,
    query: async () => candidateRows,
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
  assert.equal(graphResult.fallback_reason, null);
  assert.deepEqual(graphResult.suggestions, fallbackResult.suggestions);
});

test("suggestConnections graph mode matches SQL fallback for sparse profile scoring", async () => {
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
      current_city: "Austin",
      graduation_year: null,
      position_title: null,
      job_title: null,
      deleted_at: null,
      created_at: "2026-03-01T00:00:00.000Z",
    },
    {
      id: "candidate-alumni",
      organization_id: ORG_ID,
      user_id: "candidate-user",
      first_name: "Casey",
      last_name: "Candidate",
      email: "casey@example.com",
      major: null,
      current_company: null,
      industry: null,
      current_city: "Austin",
      graduation_year: null,
      position_title: "Founder",
      job_title: null,
      deleted_at: null,
      created_at: "2026-03-02T00:00:00.000Z",
    },
  ]);

  const graphClient = {
    isAvailable: () => true,
    query: async () => [
        {
          personKey: "user:candidate-user",
          personType: "alumni",
          personId: "candidate-alumni",
          name: "Casey Candidate",
          userId: "candidate-user",
          role: "Founder",
          major: null,
          currentCompany: null,
          industry: null,
          graduationYear: null,
          currentCity: "Austin",
        },
      ],
  };

  const graphResult = await suggestConnections({
    orgId: ORG_ID,
    serviceSupabase: stub as any,
    args: {
      person_type: "alumni",
      person_id: "source-alumni",
    },
    graphClient,
  });

  const fallbackResult = await suggestConnections({
    orgId: ORG_ID,
    serviceSupabase: stub as any,
    args: {
      person_type: "alumni",
      person_id: "source-alumni",
    },
    graphClient: {
      isAvailable: () => false,
      query: async () => [],
    },
  });

  assert.equal(graphResult.mode, "falkor");
  assert.equal(graphResult.fallback_reason, null);
  assert.deepEqual(graphResult.suggestions, fallbackResult.suggestions);
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
      if (cypher.includes(" AS distance")) {
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
  assert.equal(result.fallback_reason, null);
  assert.equal(result.state, "resolved");
  assert.deepEqual(result.suggestions, [
    {
      person_type: "alumni",
      person_id: "candidate-alumni",
      name: "Casey Candidate",
      subtitle: "Engineer • Acme",
      score: 18,
      preview: {
        role: "Engineer",
        current_company: "Acme",
        graduation_year: 2024,
      },
      reasons: [
        {
          code: "shared_company",
          label: "shared company",
          weight: 15,
          value: "Acme",
        },
        {
          code: "graduation_proximity",
          label: "graduation proximity",
          weight: 3,
          value: 2024,
        },
      ],
    },
  ]);
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
    graphClient: {
      isAvailable: () => false,
      query: async () => [],
    },
  });

  assert.equal(result.state, "resolved");
  assert.equal(result.source_person?.name, "Louis Ciccone");
  assert.deepEqual(result.suggestions.map((row) => row.name), ["Dana Coach"]);
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

  assert.deepEqual(suggestions.map((row) => row.name), ["Engineer Match"]);
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

  assert.deepEqual(suggestions.map((row) => row.name), ["Weak Match"]);
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
  assert.equal(pool.some((entry) => entry.candidate.personId === "adjacent"), false);

  const suggestions = scoreProjectedCandidates({
    source,
    allPeople: [source, ...professionalCandidates, adjacentCandidate],
    candidates: [...professionalCandidates, adjacentCandidate],
    limit: 3,
  });

  assert.equal(suggestions.some((entry) => entry.name === "Adjacent Candidate"), false);
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
    suggestions.find((row) => row.name === "Overexposed Candidate")?.reasons.map((reason) => reason.code),
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

  assert.deepEqual(stats, {
    processed: 4,
    skipped: 0,
    failed: 0,
    drainState: "processed",
    reason: null,
  });
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

// ---------------------------------------------------------------------------
// VAL-IDENTITY-001: Shared user_id projects to exactly one canonical identity
// ---------------------------------------------------------------------------

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
  assert.ok(!projected.has(`${ORG_ID}:member:m-linked`), "linked member must not get a standalone key");
  assert.ok(!projected.has(`${ORG_ID}:alumni:a-linked`), "linked alumni must not get a standalone key");

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
  assert.equal(person?.role, "Director", "alumni position_title must take precedence over member role");
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
  assert.equal(projected.size, 2, "same user_id in two orgs must produce 2 separate entries, not 1 merged");

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

  // The personKey field stored in the node stays as user:shared-uid (no org prefix in Falkor node attribute)
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
  assert.equal(projected.size, 2, "cross-org member+alumni with shared user_id must remain separate");

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

test("processGraphSyncQueue removes stale standalone nodes when linked identities reconcile to a canonical user node", async () => {
  const stub = createSupabaseStub();
  const graphClient = createInMemoryGraphClient();

  stub.seed("members", [
    {
      id: "member-linked",
      organization_id: ORG_ID,
      user_id: "linked-user",
      status: "active",
      first_name: "Link",
      last_name: "Member",
      email: "link-member@example.com",
      role: "President",
      current_company: "Acme",
      graduation_year: 2025,
      deleted_at: null,
    },
  ]);
  stub.seed("alumni", [
    {
      id: "alumni-linked",
      organization_id: ORG_ID,
      user_id: "linked-user",
      first_name: "Link",
      last_name: "Alumni",
      email: "link-alumni@example.com",
      major: "CS",
      current_company: "Acme",
      industry: "Technology",
      current_city: "Austin",
      graduation_year: 2021,
      position_title: "Engineer",
      job_title: null,
      deleted_at: null,
    },
  ]);

  graphClient.seedNode(ORG_ID, {
    orgId: ORG_ID,
    personKey: "member:member-linked",
    personType: "member",
    personId: "member-linked",
    memberId: "member-linked",
    alumniId: null,
    userId: null,
    name: "Link Member",
  });
  graphClient.seedNode(ORG_ID, {
    orgId: ORG_ID,
    personKey: "alumni:alumni-linked",
    personType: "alumni",
    personId: "alumni-linked",
    memberId: null,
    alumniId: "alumni-linked",
    userId: null,
    name: "Link Alumni",
  });

  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "queue-member",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "member-linked",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
    {
      id: "queue-alumni",
      org_id: ORG_ID,
      source_table: "alumni",
      source_id: "alumni-linked",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
  ]);
  stub.registerRpc("increment_graph_sync_attempts", () => null);

  const stats = await processGraphSyncQueue(stub as any, { graphClient });
  const snapshot = graphClient.snapshot(ORG_ID);

  assert.equal(stats.drainState, "processed");
  assert.deepEqual(
    snapshot.nodes.map((node) => node.personKey).sort(),
    ["user:linked-user"]
  );
});

test("processGraphSyncQueue reconciles unlink, relink, and org-move transitions without leaving stale keys", async () => {
  const stub = createSupabaseStub();
  const graphClient = createInMemoryGraphClient();
  const ORG_NEW = "22222222-2222-2222-2222-222222222222";

  stub.seed("members", [
    {
      id: "member-transition",
      organization_id: ORG_ID,
      user_id: "user-a",
      status: "active",
      first_name: "Terry",
      last_name: "Transition",
      email: "terry@example.com",
      role: "Captain",
      current_company: "Acme",
      graduation_year: 2025,
      deleted_at: null,
    },
  ]);
  stub.seed("alumni", [
    {
      id: "alumni-transition",
      organization_id: ORG_ID,
      user_id: "user-a",
      first_name: "Terry",
      last_name: "Transition",
      email: "terry@example.com",
      major: "Business",
      current_company: "Acme",
      industry: "Technology",
      current_city: "Austin",
      graduation_year: 2021,
      position_title: "Operator",
      job_title: null,
      deleted_at: null,
    },
  ]);
  stub.registerRpc("increment_graph_sync_attempts", () => null);

  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "initial",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "member-transition",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });
  assert.deepEqual(
    graphClient.snapshot(ORG_ID).nodes.map((node) => node.personKey).sort(),
    ["user:user-a"]
  );

  await (stub as any).from("members").update({ user_id: null }).eq("id", "member-transition");
  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "unlink",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "member-transition",
      action: "upsert",
      payload: { old_user_id: "user-a" },
      attempts: 0,
    },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });
  assert.deepEqual(
    graphClient.snapshot(ORG_ID).nodes.map((node) => node.personKey).sort(),
    ["member:member-transition", "user:user-a"]
  );

  await (stub as any).from("members").update({ user_id: "user-b" }).eq("id", "member-transition");
  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "relink",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "member-transition",
      action: "upsert",
      payload: { old_user_id: null },
      attempts: 0,
    },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });
  assert.deepEqual(
    graphClient.snapshot(ORG_ID).nodes.map((node) => node.personKey).sort(),
    ["user:user-a", "user:user-b"]
  );

  await (stub as any)
    .from("members")
    .update({ organization_id: ORG_NEW })
    .eq("id", "member-transition");
  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "org-move",
      org_id: ORG_NEW,
      source_table: "members",
      source_id: "member-transition",
      action: "upsert",
      payload: { old_user_id: "user-b", old_organization_id: ORG_ID },
      attempts: 0,
    },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });

  assert.deepEqual(
    graphClient.snapshot(ORG_ID).nodes.map((node) => node.personKey).sort(),
    ["user:user-a"]
  );
  assert.deepEqual(
    graphClient.snapshot(ORG_NEW).nodes.map((node) => node.personKey).sort(),
    ["user:user-b"]
  );
});

test("processGraphSyncQueue reconciles old mentorship endpoints to one surviving edge", async () => {
  const stub = createSupabaseStub();
  const graphClient = createInMemoryGraphClient();

  stub.seed("members", [
    {
      id: "mentor-old",
      organization_id: ORG_ID,
      user_id: "mentor-a",
      status: "active",
      first_name: "Morgan",
      last_name: "Mentor",
      email: "mentor-a@example.com",
      role: "Mentor",
      current_company: "Acme",
      graduation_year: 2020,
      deleted_at: null,
    },
    {
      id: "mentor-new",
      organization_id: ORG_ID,
      user_id: "mentor-b",
      status: "active",
      first_name: "Mona",
      last_name: "Mentor",
      email: "mentor-b@example.com",
      role: "Mentor",
      current_company: "Acme",
      graduation_year: 2021,
      deleted_at: null,
    },
    {
      id: "mentee",
      organization_id: ORG_ID,
      user_id: "mentee-a",
      status: "active",
      first_name: "Mentee",
      last_name: "User",
      email: "mentee@example.com",
      role: "Member",
      current_company: "Beta",
      graduation_year: 2026,
      deleted_at: null,
    },
  ]);
  stub.seed("mentorship_pairs", [
    {
      id: "pair-1",
      organization_id: ORG_ID,
      mentor_user_id: "mentor-a",
      mentee_user_id: "mentee-a",
      status: "active",
      deleted_at: null,
    },
  ]);
  stub.registerRpc("increment_graph_sync_attempts", () => null);

  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "seed-mentor-old",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "mentor-old",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
    {
      id: "seed-mentor-new",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "mentor-new",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
    {
      id: "seed-mentee",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "mentee",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
    {
      id: "seed-pair",
      org_id: ORG_ID,
      source_table: "mentorship_pairs",
      source_id: "pair-1",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });
  assert.deepEqual(graphClient.snapshot(ORG_ID).edges, ["user:mentor-a->user:mentee-a"]);

  await (stub as any).from("mentorship_pairs").update({ mentor_user_id: "mentor-b" }).eq("id", "pair-1");
  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "pair-transition",
      org_id: ORG_ID,
      source_table: "mentorship_pairs",
      source_id: "pair-1",
      action: "upsert",
      payload: { old_mentor_user_id: "mentor-a", old_mentee_user_id: "mentee-a" },
      attempts: 0,
    },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });

  assert.deepEqual(graphClient.snapshot(ORG_ID).edges, ["user:mentor-b->user:mentee-a"]);
});

test("processGraphSyncQueue reshapes people and mentorship edges for deactivation, deletes, and duplicate rows", async () => {
  const stub = createSupabaseStub();
  const graphClient = createInMemoryGraphClient();

  stub.seed("members", [
    {
      id: "member-active",
      organization_id: ORG_ID,
      user_id: "shared-person",
      status: "active",
      first_name: "Shared",
      last_name: "Member",
      email: "shared-member@example.com",
      role: "Member",
      current_company: "Acme",
      graduation_year: 2025,
      deleted_at: null,
    },
    {
      id: "other-user-row",
      organization_id: ORG_ID,
      user_id: "other-user",
      status: "active",
      first_name: "Other",
      last_name: "User",
      email: "other@example.com",
      role: "Mentee",
      current_company: "Beta",
      graduation_year: 2026,
      deleted_at: null,
    },
  ]);
  stub.seed("alumni", [
    {
      id: "alumni-active",
      organization_id: ORG_ID,
      user_id: "shared-person",
      first_name: "Shared",
      last_name: "Alumni",
      email: "shared-alumni@example.com",
      major: "CS",
      current_company: "Acme",
      industry: "Technology",
      current_city: "Austin",
      graduation_year: 2022,
      position_title: "Engineer",
      job_title: null,
      deleted_at: null,
    },
  ]);
  stub.seed("mentorship_pairs", [
    {
      id: "pair-a",
      organization_id: ORG_ID,
      mentor_user_id: "shared-person",
      mentee_user_id: "other-user",
      status: "active",
      deleted_at: null,
    },
    {
      id: "pair-b",
      organization_id: ORG_ID,
      mentor_user_id: "shared-person",
      mentee_user_id: "other-user",
      status: "active",
      deleted_at: null,
    },
  ]);
  stub.registerRpc("increment_graph_sync_attempts", () => null);

  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "seed-member",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "member-active",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
    {
      id: "seed-alumni",
      org_id: ORG_ID,
      source_table: "alumni",
      source_id: "alumni-active",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
    {
      id: "seed-other",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "other-user-row",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
    {
      id: "seed-pair-a",
      org_id: ORG_ID,
      source_table: "mentorship_pairs",
      source_id: "pair-a",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });
  assert.deepEqual(graphClient.snapshot(ORG_ID).edges, ["user:shared-person->user:other-user"]);

  await (stub as any).from("members").update({ status: "inactive" }).eq("id", "member-active");
  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "inactive-member",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "member-active",
      action: "upsert",
      payload: { old_user_id: "shared-person" },
      attempts: 0,
    },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });

  const alumniOnlyNode = graphClient.snapshot(ORG_ID).nodes.find((node) => node.personKey === "user:shared-person");
  assert.equal(alumniOnlyNode?.memberId ?? null, null);
  assert.equal(alumniOnlyNode?.alumniId, "alumni-active");

  await (stub as any).from("mentorship_pairs").update({ status: "inactive" }).eq("id", "pair-a");
  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "inactive-pair-a",
      org_id: ORG_ID,
      source_table: "mentorship_pairs",
      source_id: "pair-a",
      action: "upsert",
      payload: { old_mentor_user_id: "shared-person", old_mentee_user_id: "other-user" },
      attempts: 0,
    },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });
  assert.deepEqual(graphClient.snapshot(ORG_ID).edges, ["user:shared-person->user:other-user"]);

  await (stub as any).from("mentorship_pairs").update({ status: "inactive" }).eq("id", "pair-b");
  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "inactive-pair-b",
      org_id: ORG_ID,
      source_table: "mentorship_pairs",
      source_id: "pair-b",
      action: "upsert",
      payload: { old_mentor_user_id: "shared-person", old_mentee_user_id: "other-user" },
      attempts: 0,
    },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });
  assert.deepEqual(graphClient.snapshot(ORG_ID).edges, []);

  await (stub as any).from("alumni").delete().eq("id", "alumni-active");
  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "delete-alumni",
      org_id: ORG_ID,
      source_table: "alumni",
      source_id: "alumni-active",
      action: "delete",
      payload: { old_user_id: "shared-person" },
      attempts: 0,
    },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });

  assert.ok(
    !graphClient.snapshot(ORG_ID).nodes.some((node) => node.personKey === "user:shared-person")
  );
});

test("processGraphSyncQueue converges for replay, out-of-order mentorship work, and stale items after newer transitions", async () => {
  const stub = createSupabaseStub();
  const graphClient = createInMemoryGraphClient();

  stub.seed("members", [
    {
      id: "mentor-row",
      organization_id: ORG_ID,
      user_id: "mentor-user",
      status: "active",
      first_name: "Mentor",
      last_name: "Replay",
      email: "mentor@example.com",
      role: "Mentor",
      current_company: "Acme",
      graduation_year: 2020,
      deleted_at: null,
    },
    {
      id: "mentee-row",
      organization_id: ORG_ID,
      user_id: "mentee-user",
      status: "active",
      first_name: "Mentee",
      last_name: "Replay",
      email: "mentee@example.com",
      role: "Mentee",
      current_company: "Beta",
      graduation_year: 2026,
      deleted_at: null,
    },
  ]);
  stub.seed("mentorship_pairs", [
    {
      id: "pair-replay",
      organization_id: ORG_ID,
      mentor_user_id: "mentor-user",
      mentee_user_id: "mentee-user",
      status: "active",
      deleted_at: null,
    },
  ]);
  stub.registerRpc("increment_graph_sync_attempts", () => null);

  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "pair-first",
      org_id: ORG_ID,
      source_table: "mentorship_pairs",
      source_id: "pair-replay",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });
  assert.deepEqual(graphClient.snapshot(ORG_ID).edges, []);

  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "mentor-row",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "mentor-row",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
    {
      id: "mentee-row",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "mentee-row",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
    {
      id: "pair-replay",
      org_id: ORG_ID,
      source_table: "mentorship_pairs",
      source_id: "pair-replay",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
    {
      id: "pair-replay-duplicate",
      org_id: ORG_ID,
      source_table: "mentorship_pairs",
      source_id: "pair-replay",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });
  await processGraphSyncQueue(stub as any, { graphClient });

  assert.deepEqual(graphClient.snapshot(ORG_ID).edges, ["user:mentor-user->user:mentee-user"]);

  await (stub as any).from("members").update({ user_id: "mentor-user-new" }).eq("id", "mentor-row");
  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "current-transition",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "mentor-row",
      action: "upsert",
      payload: { old_user_id: "mentor-user" },
      attempts: 0,
    },
    {
      id: "stale-transition",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "mentor-row",
      action: "upsert",
      payload: { old_user_id: null },
      attempts: 0,
    },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });

  assert.deepEqual(
    graphClient.snapshot(ORG_ID).nodes.map((node) => node.personKey).sort(),
    ["user:mentee-user", "user:mentor-user-new"]
  );
});

test("suggestConnections stays recommendation-safe after graph transitions and records org-scoped fallback observability", async () => {
  const stub = createSupabaseStub();
  const graphClient = createInMemoryGraphClient();

  seedSuggestionFixture(stub);
  graphClient.seedNode(ORG_ID, {
    orgId: ORG_ID,
    personKey: "user:00000000-0000-0000-0000-000000000001",
    personType: "alumni",
    personId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
    memberId: null,
    alumniId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
    userId: "00000000-0000-0000-0000-000000000001",
    name: "Alex Source",
    role: "Engineer",
    major: "Computer Science",
    currentCompany: "Acme",
    industry: "Technology",
    graduationYear: 2018,
    currentCity: "Austin",
  });
  graphClient.seedNode(ORG_ID, {
    orgId: ORG_ID,
    personKey: "user:00000000-0000-0000-0000-000000000002",
    personType: "alumni",
    personId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
    memberId: null,
    alumniId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
    userId: "00000000-0000-0000-0000-000000000002",
    name: "Dina Direct",
    role: "VP Product",
    major: null,
    currentCompany: "Acme",
    industry: null,
    graduationYear: 2018,
    currentCity: null,
  });
  graphClient.seedNode(ORG_ID, {
    orgId: ORG_ID,
    personKey: "alumni:stale-dina",
    personType: "alumni",
    personId: "stale-dina",
    memberId: null,
    alumniId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
    userId: null,
    name: "Dina Direct",
    role: "VP Product",
    major: null,
    currentCompany: "Acme",
    industry: null,
    graduationYear: 2018,
    currentCity: null,
  });
  graphClient.seedNode(ORG_ID, {
    orgId: ORG_ID,
    personKey: "user:00000000-0000-0000-0000-000000000003",
    personType: "alumni",
    personId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3",
    memberId: null,
    alumniId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3",
    userId: "00000000-0000-0000-0000-000000000003",
    name: "Sam Second",
    role: "Founder",
    major: "Computer Science",
    currentCompany: null,
    industry: "Technology",
    graduationYear: null,
    currentCity: "Austin",
  });
  graphClient.seedNode(ORG_ID, {
    orgId: ORG_ID,
    personKey: "user:00000000-0000-0000-0000-000000000004",
    personType: "alumni",
    personId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4",
    memberId: null,
    alumniId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4",
    userId: "00000000-0000-0000-0000-000000000004",
    name: "Ava Attribute",
    role: "Investor",
    major: "Computer Science",
    currentCompany: "Acme",
    industry: "Technology",
    graduationYear: 2018,
    currentCity: "Austin",
  });
  graphClient.seedEdge(
    ORG_ID,
    "user:00000000-0000-0000-0000-000000000001",
    "user:00000000-0000-0000-0000-000000000002"
  );
  graphClient.seedEdge(
    ORG_ID,
    "user:00000000-0000-0000-0000-000000000002",
    "user:00000000-0000-0000-0000-000000000003"
  );

  const graphResult = await suggestConnections({
    orgId: ORG_ID,
    serviceSupabase: stub as any,
    args: { person_type: "alumni", person_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1" },
    graphClient,
  });
  const sqlFallback = await suggestConnections({
    orgId: ORG_ID,
    serviceSupabase: stub as any,
    args: { person_type: "alumni", person_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1" },
    graphClient: {
      isAvailable: () => false,
      getUnavailableReason: () => "disabled",
      query: async () => [],
    },
  });

  assert.equal(graphResult.mode, "falkor");
  assert.deepEqual(
    graphResult.suggestions.map((row) => row.person_id),
    [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4",
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3",
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
    ]
  );
  assert.deepEqual(graphResult.suggestions, sqlFallback.suggestions);

  const telemetry = getSuggestionObservabilityByOrg(ORG_ID);
  assert.equal(telemetry.falkorCount, 1);
  assert.equal(telemetry.sqlFallbackCount, 1);
  assert.equal(telemetry.fallbackReasonCounts.disabled, 1);
  assert.equal(telemetry.strongResultCount, 2);
  assert.equal(telemetry.lastResultStrength, "strong");
});

test("graph health surface exposes lag, retries, degraded freshness, dead letters, and preserves failure evidence after recovery", async () => {
  const stub = createSupabaseStub();
  const graphClient = createInMemoryGraphClient();
  const oldTimestamp = new Date(Date.now() - 5 * 60_000).toISOString();

  stub.seed("graph_sync_queue", [
    {
      id: "pending-old",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "member-health",
      created_at: oldTimestamp,
      processed_at: null,
      attempts: 1,
      last_error: "temporary failure",
    },
    {
      id: "dead-letter",
      org_id: ORG_ID,
      source_table: "members",
      source_id: "member-health",
      created_at: oldTimestamp,
      processed_at: null,
      attempts: 3,
      last_error: "permanent failure",
    },
  ]);
  stub.seed("members", [
    {
      id: "member-health",
      organization_id: ORG_ID,
      user_id: "health-user",
      status: "active",
      first_name: "Health",
      last_name: "User",
      email: "health@example.com",
      role: "Member",
      current_company: "Acme",
      graduation_year: 2025,
      deleted_at: null,
    },
  ]);

  let queueAttempts = 0;
  stub.registerRpc("dequeue_graph_sync_queue", () => {
    if (queueAttempts === 0) {
      queueAttempts += 1;
      return [
        {
          id: "dead-letter",
          org_id: ORG_ID,
          source_table: "members",
          source_id: "member-health",
          action: "upsert",
          payload: {},
          attempts: 2,
        },
      ];
    }

    return [
      {
        id: "recovery-item",
        org_id: ORG_ID,
        source_table: "members",
        source_id: "member-health",
        action: "upsert",
        payload: {},
        attempts: 0,
      },
    ];
  });
  stub.registerRpc("increment_graph_sync_attempts", ({ p_id, p_error }) => {
    const rows = stub.getRows("graph_sync_queue");
    const row = rows.find((entry) => entry.id === p_id);
    if (row) {
      row.attempts = Number(row.attempts ?? 0) + 1;
      row.last_error = p_error;
    }
    return null;
  });

  const failingGraphClient = {
    isAvailable: () => true,
    query: async () => {
      throw new Error("forced graph failure");
    },
  };

  const failedStats = await processGraphSyncQueue(stub as any, {
    graphClient: failingGraphClient,
  });
  assert.equal(failedStats.failed, 1);

  const healthBeforeRecovery = await getGraphHealthSurface(stub as any, ORG_ID);
  assert.equal(healthBeforeRecovery.freshness.state, "stale");
  assert.equal(healthBeforeRecovery.queue.retriedPendingCount, 1);
  assert.equal(healthBeforeRecovery.queue.deadLetterCount, 1);
  assert.equal(healthBeforeRecovery.failures.deadLetterCount, 1);
  assert.equal(healthBeforeRecovery.failures.lastError, "forced graph failure");

  await processGraphSyncQueue(stub as any, { graphClient });
  await (stub as any).from("graph_sync_queue").delete().eq("id", "pending-old");
  await (stub as any).from("graph_sync_queue").delete().eq("id", "dead-letter");

  const healthAfterRecovery = await getGraphHealthSurface(stub as any, ORG_ID);
  assert.equal(healthAfterRecovery.queue.pendingCount, 0);
  assert.equal(healthAfterRecovery.failures.deadLetterCount, 1);
  assert.ok(healthAfterRecovery.failures.lastSuccessAt);

  stub.simulateError("graph_sync_queue", { message: "queue read failed" });
  const degradedHealth = await getGraphHealthSurface(stub as any, ORG_ID);
  assert.equal(degradedHealth.freshness.state, "degraded");
});
