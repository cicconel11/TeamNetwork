import test from "node:test";
import assert from "node:assert/strict";
import { loadMentorInputs } from "@/lib/mentorship/queries";
import { suggestMentors } from "@/lib/mentorship/ai-suggestions";

type Row = Record<string, unknown>;
type QueryError = { code?: string; message: string };
type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; value: unknown[] }
  | { kind: "is"; column: string; value: unknown };
type Query = { table: string; columns: string; filters: Filter[]; single: boolean };
type QueryResponse = { data: Row[] | Row | null; error: QueryError | null };

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return filters.reduce((current, filter) => {
    if (filter.kind === "eq") {
      return current.filter((row) => row[filter.column] === filter.value);
    }
    if (filter.kind === "in") {
      return current.filter((row) => filter.value.includes(row[filter.column]));
    }
    return current.filter((row) => {
      const cell = row[filter.column];
      if (filter.value === null) return cell === null || cell === undefined;
      return cell === filter.value;
    });
  }, rows);
}

function createQueryStub(
  rowsByTable: Record<string, Row[]> = {},
  onQuery?: (query: Query) => QueryResponse | null
) {
  const selectCalls: Array<{ table: string; columns: string }> = [];

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const filters: Filter[] = [];
          selectCalls.push({ table, columns });

          const run = (single: boolean): QueryResponse => {
            const custom = onQuery?.({ table, columns, filters, single });
            if (custom) return custom;

            const rows = applyFilters(rowsByTable[table] ?? [], filters);
            return {
              data: single ? rows[0] ?? null : rows,
              error: null,
            };
          };

          const builder = {
            eq(column: string, value: unknown) {
              filters.push({ kind: "eq", column, value });
              return builder;
            },
            in(column: string, value: unknown[]) {
              filters.push({ kind: "in", column, value });
              return builder;
            },
            is(column: string, value: unknown) {
              filters.push({ kind: "is", column, value });
              return builder;
            },
            maybeSingle() {
              return Promise.resolve(run(true));
            },
            then(
              resolve: (value: QueryResponse) => void,
              reject?: (reason: unknown) => void
            ) {
              return Promise.resolve(run(false)).then(resolve, reject);
            },
          };

          return builder;
        },
      };
    },
  };

  return { client, selectCalls };
}

test("loadMentorInputs falls back to stable mentor profile columns on missing-column errors", async () => {
  let richMentorProfileAttempts = 0;
  const { client, selectCalls } = createQueryStub({}, (query) => {
    if (query.table === "mentor_profiles") {
      if (query.columns.includes("topics")) {
        richMentorProfileAttempts += 1;
        return {
          data: null,
          error: {
            code: "42703",
            message: "column mentor_profiles.topics does not exist",
          },
        };
      }

      return {
        data: [
          {
            user_id: "mentor-1",
            expertise_areas: ["Leadership"],
            is_active: true,
          },
        ],
        error: null,
      };
    }

    if (query.table === "alumni") {
      return {
        data: [
          {
            user_id: "mentor-1",
            industry: "Technology",
            job_title: "Engineering Manager",
            position_title: null,
            current_company: "Acme",
            current_city: "New York",
            graduation_year: 2012,
          },
        ],
        error: null,
      };
    }

    return null;
  });

  const mentors = await loadMentorInputs(client as never, "org-1");

  assert.equal(richMentorProfileAttempts, 1);
  assert.equal(
    selectCalls.find((call) => call.table === "mentor_profiles")?.columns.includes("custom_attributes"),
    false
  );
  assert.deepEqual(
    selectCalls
      .filter((call) => call.table === "mentor_profiles")
      .map((call) => call.columns),
    [
      "user_id, topics, expertise_areas, sports, positions, industries, role_families, max_mentees, current_mentee_count, accepting_new, is_active, meeting_preferences, years_of_experience",
      "user_id, expertise_areas, is_active",
    ]
  );
  assert.deepEqual(mentors, [
    {
      userId: "mentor-1",
      orgId: "org-1",
      topics: [],
      expertiseAreas: ["Leadership"],
      nativeSports: [],
      nativePositions: [],
      nativeIndustries: [],
      nativeRoleFamilies: [],
      industry: "Technology",
      jobTitle: "Engineering Manager",
      positionTitle: null,
      currentCompany: "Acme",
      currentCity: "New York",
      graduationYear: 2012,
      maxMentees: 3,
      currentMenteeCount: 0,
      acceptingNew: true,
      isActive: true,
      customAttributes: null,
    },
  ]);
});

test("suggestMentors hydrates names through users lookups without embedded users joins", async () => {
  const { client, selectCalls } = createQueryStub({
    user_organization_roles: [
      {
        organization_id: "org-1",
        user_id: "mentee-1",
        role: "active_member",
        status: "active",
      },
      {
        organization_id: "org-1",
        user_id: "mentor-1",
        role: "alumni",
        status: "active",
      },
    ],
    users: [
      { id: "mentee-1", name: "Mentee One", email: "mentee@example.com" },
      { id: "mentor-1", name: "Mentor One", email: "mentor@example.com" },
    ],
    mentor_profiles: [
      {
        organization_id: "org-1",
        user_id: "mentor-1",
        topics: ["Leadership"],
        expertise_areas: [],
        sports: [],
        positions: [],
        industries: [],
        role_families: [],
        max_mentees: 3,
        current_mentee_count: 0,
        accepting_new: true,
        is_active: true,
      },
    ],
    mentee_preferences: [
      {
        organization_id: "org-1",
        user_id: "mentee-1",
        goals: null,
        preferred_topics: ["Leadership"],
        preferred_industries: [],
        preferred_role_families: [],
        preferred_sports: [],
        preferred_positions: [],
        required_attributes: [],
        nice_to_have_attributes: [],
        time_availability: null,
        communication_prefs: [],
        geographic_pref: null,
      },
    ],
    alumni: [],
    mentorship_pairs: [],
    organizations: [{ id: "org-1", settings: null }],
  });

  const result = await suggestMentors(client as never, "org-1", {
    menteeUserId: "mentee-1",
    limit: 5,
  });

  assert.equal(result.state, "resolved");
  assert.equal(result.mentee?.name, "Mentee One");
  assert.equal(result.suggestions[0]?.mentor.name, "Mentor One");
  assert.equal(result.suggestions[0]?.mentor.user_id, "mentor-1");
  assert.ok(result.suggestions[0]?.score > 0);
  assert.equal(
    selectCalls.some((call) => call.columns.includes("users(")),
    false
  );
});
