import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listMembersModule } from "../src/lib/ai/tools/registry/list-members.ts";

const ORG_ID = "org-1";
const USER_ID = "user-1";

type Row = Record<string, unknown>;

interface TableFixtures {
  members: Row[];
  users: Row[];
}

// Chainable stub. `members` resolves via the awaited query (returns `{data,error}`
// directly because list-members awaits `query`); `users` resolves via the
// `.in()` lookup which is also awaited as `{data,error}`.
function makeStubSb(fixtures: TableFixtures) {
  function builder(table: keyof TableFixtures) {
    const rows = fixtures[table] ?? [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order", "limit", "ilike"]) {
      chain[method] = () => chain;
    }
    // `.in()` is awaited directly for the users lookup → resolve to {data,error}.
    chain.in = async () => ({ data: rows, error: null });
    chain.then = (resolve: (value: { data: Row[]; error: null }) => void) => {
      resolve({ data: rows, error: null });
    };
    return chain;
  }
  return { from: (table: string) => builder(table as keyof TableFixtures) };
}

const ctx = {
  orgId: ORG_ID,
  userId: USER_ID,
  serviceSupabase: null as never,
  authorization: { kind: "preverified_admin", source: "ai_org_context" } as const,
};

const logContext = { requestId: "req-1", route: "test" } as never;

async function execute(args: Record<string, unknown>, fixtures: TableFixtures) {
  const parsed = listMembersModule.argsSchema.parse(args);
  return listMembersModule.execute(parsed as never, {
    ctx: ctx as never,
    sb: makeStubSb(fixtures) as never,
    logContext,
    actorRole: "admin",
  } as never);
}

const LONG_SUMMARY = "s".repeat(900);

const MEMBER_ROW = {
  id: "m1",
  user_id: "u1",
  status: "active",
  role: "member",
  created_at: "2026-01-01T00:00:00.000Z",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  current_company: "Analytical Engines",
  industry: "Computing",
  headline: "Pioneer",
  summary: LONG_SUMMARY,
  skills: ["math", "programming"],
  certifications: ["cert-a"],
  languages: ["English"],
};

const FIXTURES: TableFixtures = {
  members: [MEMBER_ROW],
  users: [{ id: "u1", name: "Ada Lovelace" }],
};

describe("list_members — lean default", () => {
  it("returns only id, name, role, email when fields omitted", async () => {
    const result = await execute({}, FIXTURES);
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const rows = result.data as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), ["email", "id", "name", "role"]);
    // Heavy fields absent by default.
    assert.equal("summary" in rows[0], false);
    assert.equal("skills" in rows[0], false);
    assert.equal("current_company" in rows[0], false);
  });

  it("keeps name + email (grounding verifier depends on them)", async () => {
    const result = await execute({}, FIXTURES);
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const row = (result.data as Array<Record<string, unknown>>)[0];
    assert.equal(row.name, "Ada Lovelace");
    assert.equal(row.email, "ada@example.com");
  });
});

describe("list_members — fields opt-in", () => {
  it("returns heavy fields when requested, with summary truncated to 500 chars", async () => {
    const result = await execute({ fields: ["name", "summary", "skills"] }, FIXTURES);
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const row = (result.data as Array<Record<string, unknown>>)[0];
    assert.deepEqual(Object.keys(row).sort(), ["name", "skills", "summary"]);
    assert.equal((row.summary as string).length, 500);
    assert.deepEqual(row.skills, ["math", "programming"]);
  });

  it("never repopulates a field absent from the row (narrows only)", async () => {
    // Member with no summary — requesting it yields null, not fabricated text.
    const result = await execute({ fields: ["name", "summary"] }, {
      members: [{ ...MEMBER_ROW, summary: null }],
      users: [{ id: "u1", name: "Ada Lovelace" }],
    });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const row = (result.data as Array<Record<string, unknown>>)[0];
    assert.equal(row.summary, null);
    assert.equal("email" in row, false); // not requested → absent
  });
});

describe("list_members — schema boundary", () => {
  it("rejects an invalid field name", () => {
    assert.throws(() => listMembersModule.argsSchema.parse({ fields: ["password_hash"] }));
  });

  it("rejects an empty fields array", () => {
    assert.throws(() => listMembersModule.argsSchema.parse({ fields: [] }));
  });

  it("rejects unknown top-level args (strict)", () => {
    assert.throws(() => listMembersModule.argsSchema.parse({ bogus: true }));
  });

  it("accepts a valid fields subset", () => {
    assert.doesNotThrow(() =>
      listMembersModule.argsSchema.parse({ fields: ["name", "email"], limit: 10 })
    );
  });
});
