import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listMemberPreferencesModule } from "../src/lib/ai/tools/registry/list-member-preferences.ts";

const ORG_ID = "org-1";
const USER_ID = "actor-1";

type Row = Record<string, unknown>;

interface TableFixtures {
  mentor_profiles: Row[];
  mentee_preferences: Row[];
  users: Row[];
}

function makeStubSb(fixtures: TableFixtures) {
  function builder(table: keyof TableFixtures) {
    const rows = fixtures[table] ?? [];
    let filtered = [...rows];
    const chain = {
      select(_cols: string) {
        void _cols;
        return chain;
      },
      eq(col: string, val: unknown) {
        filtered = filtered.filter((row) => row[col] === val);
        return chain;
      },
      in(col: string, values: unknown[]) {
        const set = new Set(values);
        filtered = filtered.filter((row) => set.has(row[col]));
        return chain;
      },
      then(
        resolve: (value: { data: Row[]; error: null }) => void,
      ) {
        resolve({ data: filtered, error: null });
      },
    };
    return chain;
  }

  return {
    from: (table: string) => builder(table as keyof TableFixtures),
  };
}

const ctx = {
  orgId: ORG_ID,
  userId: USER_ID,
  serviceSupabase: null as never,
  authorization: { kind: "preverified_admin", source: "ai_org_context" } as const,
};

const logContext = { requestId: "req-1", route: "test" } as never;

async function execute(
  args: { limit?: number; sport?: string; topic?: string },
  fixtures: TableFixtures,
  actorRole: "admin" | "active_member" | "alumni" | "parent" = "admin",
) {
  const parsed = listMemberPreferencesModule.argsSchema.parse(args);
  return listMemberPreferencesModule.execute(parsed as never, {
    ctx: ctx as never,
    sb: makeStubSb(fixtures) as never,
    logContext,
    actorRole,
  });
}

describe("list_member_preferences", () => {
  it("returns no_results when no mentor profiles or mentee preferences exist", async () => {
    const result = await execute(
      {},
      { mentor_profiles: [], mentee_preferences: [], users: [] },
    );
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as { state: string; total: number; members: unknown[] };
    assert.equal(data.state, "no_results");
    assert.equal(data.total, 0);
    assert.deepEqual(data.members, []);
  });

  it("aggregates mentor + mentee rows by user_id and enriches with user names", async () => {
    const result = await execute(
      {},
      {
        mentor_profiles: [
          {
            user_id: "u1",
            organization_id: ORG_ID,
            is_active: true,
            sports: ["Tennis", "Squash"],
            topics: ["Career"],
            positions: ["Captain"],
            industries: ["Tech"],
            time_commitment: "2 hours/week",
            accepting_new: true,
          },
        ],
        mentee_preferences: [
          {
            user_id: "u2",
            organization_id: ORG_ID,
            preferred_sports: ["Tennis"],
            preferred_topics: ["Networking"],
            preferred_industries: [],
            preferred_positions: [],
            time_availability: "Weekday evenings",
            seeking_mentorship: true,
          },
        ],
        users: [
          { id: "u1", name: "Alice Mentor", email: "alice@example.com" },
          { id: "u2", name: "Bob Mentee", email: "bob@example.com" },
        ],
      },
    );

    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as {
      state: string;
      total: number;
      members: Array<{
        user_id: string;
        name: string;
        as_mentor: unknown;
        as_mentee: { time_availability: string | null } | null;
      }>;
    };
    assert.equal(data.state, "resolved");
    assert.equal(data.total, 2);
    assert.equal(data.members.length, 2);
    const alice = data.members.find((m) => m.user_id === "u1")!;
    const bob = data.members.find((m) => m.user_id === "u2")!;
    assert.equal(alice.name, "Alice Mentor");
    assert.ok(alice.as_mentor);
    assert.equal(alice.as_mentee, null);
    assert.equal(bob.as_mentor, null);
    assert.equal(bob.as_mentee?.time_availability, "Weekday evenings");
  });

  it("filters by sport substring case-insensitively across mentor and mentee preferences", async () => {
    const result = await execute(
      { sport: "tennis" },
      {
        mentor_profiles: [
          {
            user_id: "u1",
            organization_id: ORG_ID,
            is_active: true,
            sports: ["Tennis"],
            topics: [],
            positions: [],
            industries: [],
            time_commitment: null,
            accepting_new: true,
          },
          {
            user_id: "u3",
            organization_id: ORG_ID,
            is_active: true,
            sports: ["Golf"],
            topics: [],
            positions: [],
            industries: [],
            time_commitment: null,
            accepting_new: true,
          },
        ],
        mentee_preferences: [
          {
            user_id: "u2",
            organization_id: ORG_ID,
            preferred_sports: ["TENNIS"],
            preferred_topics: [],
            preferred_industries: [],
            preferred_positions: [],
            time_availability: null,
            seeking_mentorship: false,
          },
        ],
        users: [
          { id: "u1", name: "Alice", email: "a@example.com" },
          { id: "u2", name: "Bob", email: "b@example.com" },
          { id: "u3", name: "Carol", email: "c@example.com" },
        ],
      },
    );

    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as { total: number; members: Array<{ user_id: string }> };
    assert.equal(data.total, 2);
    const ids = data.members.map((m) => m.user_id).sort();
    assert.deepEqual(ids, ["u1", "u2"]);
  });

  it("respects limit cap (max 50)", async () => {
    const mentorRows = Array.from({ length: 5 }, (_, idx) => ({
      user_id: `u${idx}`,
      organization_id: ORG_ID,
      is_active: true,
      sports: ["Tennis"],
      topics: [],
      positions: [],
      industries: [],
      time_commitment: null,
      accepting_new: true,
    }));
    const userRows = Array.from({ length: 5 }, (_, idx) => ({
      id: `u${idx}`,
      name: `User ${idx}`,
      email: `u${idx}@example.com`,
    }));

    const result = await execute(
      { limit: 2 },
      { mentor_profiles: mentorRows, mentee_preferences: [], users: userRows },
    );
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as { total: number; members: unknown[] };
    assert.equal(data.total, 5);
    assert.equal(data.members.length, 2);
  });

  it("skips inactive mentor profiles via .eq filter chain", async () => {
    // Stub matches eq on is_active=true; inactive rows should be filtered out
    // before aggregation.
    const result = await execute(
      {},
      {
        mentor_profiles: [
          {
            user_id: "u1",
            organization_id: ORG_ID,
            is_active: false,
            sports: ["Tennis"],
            topics: [],
            positions: [],
            industries: [],
            time_commitment: null,
            accepting_new: true,
          },
        ],
        mentee_preferences: [],
        users: [{ id: "u1", name: "Alice", email: "a@example.com" }],
      },
    );
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as { state: string; total: number };
    assert.equal(data.state, "no_results");
    assert.equal(data.total, 0);
  });
});

/* ── U9: email redaction for non-admin actors ──────────────────────────────── */

describe("list_member_preferences email redaction (U9)", () => {
  const fixtures: TableFixtures = {
    mentor_profiles: [
      {
        user_id: "u1",
        organization_id: ORG_ID,
        sports: ["basketball"],
        topics: ["finance"],
        positions: [],
        industries: [],
        time_commitment: null,
        accepting_new: true,
        is_active: true,
      },
    ],
    mentee_preferences: [],
    users: [
      { id: "u1", name: null, email: "u1@example.com" },
    ],
  };

  it("non-admin actors get email: null and never an email-as-name fallback", async () => {
    const result = await execute({}, fixtures, "active_member");
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as { members: Array<{ name: string; email: string | null }> };
    assert.equal(data.members.length, 1);
    assert.equal(data.members[0].email, null);
    assert.equal(data.members[0].name, "Member");
  });

  it("admin actors still see emails and the email-as-name fallback", async () => {
    const result = await execute({}, fixtures, "admin");
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as { members: Array<{ name: string; email: string | null }> };
    assert.equal(data.members[0].email, "u1@example.com");
    assert.equal(data.members[0].name, "u1@example.com");
  });

  it("executor routes non-admin calls through the RLS client (source assert)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../src/lib/ai/tools/executor.ts", import.meta.url),
      "utf8"
    );
    // Tool is in the non-admin RLS set...
    assert.match(
      src,
      /NON_ADMIN_RLS_READ_TOOL_NAMES[\s\S]*?"list_member_preferences"[\s\S]*?\]\);/
    );
    // ...and the dispatcher threads the resolved actor role to modules.
    assert.match(src, /dispatchToolModule\([\s\S]*?actorRole:\s*policyActor\.role/);
    // Null RLS client fails closed (auth_error) rather than falling back to service role.
    assert.match(src, /auth-bound client unavailable for non-admin tool/);
  });
});
