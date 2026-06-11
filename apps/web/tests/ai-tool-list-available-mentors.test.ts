import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listAvailableMentorsModule } from "../src/lib/ai/tools/registry/list-available-mentors.ts";
import { formatListAvailableMentorsResponse } from "../src/app/api/ai/[orgId]/chat/handler/formatters/reads.ts";

const ORG_ID = "org-1";

type Row = Record<string, unknown>;

interface TableFixtures {
  mentor_profiles: Row[];
  users: Row[];
  alumni: Row[];
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
      then(resolve: (value: { data: Row[]; error: null }) => void) {
        resolve({ data: filtered, error: null });
      },
    };
    return chain;
  }

  return {
    from: (table: string) => builder(table as keyof TableFixtures),
  };
}

function mentorRow(overrides: Row): Row {
  return {
    user_id: "u1",
    organization_id: ORG_ID,
    is_active: true,
    accepting_new: true,
    topics: [],
    sports: [],
    positions: [],
    industries: [],
    max_mentees: 3,
    current_mentee_count: 0,
    ...overrides,
  };
}

const ctx = {
  orgId: ORG_ID,
  userId: "actor-1",
  serviceSupabase: null as never,
  authorization: { kind: "preverified_admin", source: "ai_org_context" } as const,
};
const logContext = { requestId: "req-1", route: "test" } as never;

async function execute(
  args: { limit?: number; topic?: string; sport?: string; position?: string },
  fixtures: TableFixtures,
) {
  const parsed = listAvailableMentorsModule.argsSchema.parse(args);
  return listAvailableMentorsModule.execute(parsed as never, {
    ctx: ctx as never,
    sb: makeStubSb(fixtures) as never,
    logContext,
    actorRole: "admin",
  } as never);
}

const baseFixtures = (): TableFixtures => ({
  mentor_profiles: [
    mentorRow({
      user_id: "tech-by-topic",
      topics: ["technology", "product"],
      max_mentees: 2,
    }),
    mentorRow({
      user_id: "tech-by-industry",
      industries: ["Technology"],
      max_mentees: 1,
    }),
    mentorRow({
      user_id: "healthcare",
      topics: ["healthcare", "operations"],
      industries: ["Healthcare"],
      max_mentees: 4,
    }),
    mentorRow({
      user_id: "full",
      topics: ["technology"],
      max_mentees: 2,
      current_mentee_count: 2,
    }),
  ],
  users: [
    { id: "tech-by-topic", name: "Sarah Gallagher", email: "s@example.com" },
    { id: "tech-by-industry", name: "Xavier Lynch", email: "x@example.com" },
    { id: "healthcare", name: "Maria Bell", email: "m@example.com" },
    { id: "full", name: "Full Mentor", email: "f@example.com" },
  ],
  alumni: [],
});

describe("list_available_mentors topic filter", () => {
  it("topic filter matches mentor topics and industries, case-insensitively", async () => {
    const result = await execute({ topic: "Technology" }, baseFixtures());
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as {
      total_available: number;
      mentors: Array<{ mentor: { user_id: string } }>;
      filters: { topic: string | null };
    };
    assert.equal(data.total_available, 2);
    const ids = data.mentors.map((m) => m.mentor.user_id).sort();
    assert.deepEqual(ids, ["tech-by-industry", "tech-by-topic"]);
    assert.equal(data.filters.topic, "Technology");
  });

  it("non-matching filter returns no_results with the filter echoed", async () => {
    const result = await execute({ topic: "law" }, baseFixtures());
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as {
      state: string;
      total_available: number;
      filters: { topic: string | null };
    };
    assert.equal(data.state, "no_results");
    assert.equal(data.total_available, 0);
    assert.equal(data.filters.topic, "law");
  });

  it("no filter keeps all open-capacity mentors, sorted by open slots", async () => {
    const result = await execute({}, baseFixtures());
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as {
      total_available: number;
      mentors: Array<{ mentor: { user_id: string }; open_slots: number }>;
      filters: { topic: string | null };
    };
    // "full" is at capacity and excluded.
    assert.equal(data.total_available, 3);
    assert.equal(data.mentors[0].mentor.user_id, "healthcare");
    assert.equal(data.mentors[0].open_slots, 4);
    assert.equal(data.filters.topic, null);
  });

  it("rows expose topics and industries so answers can show relevance", async () => {
    const result = await execute({ topic: "technology" }, baseFixtures());
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as {
      mentors: Array<{ mentor: { user_id: string }; topics: string[]; industries: string[] }>;
    };
    const byTopic = data.mentors.find((m) => m.mentor.user_id === "tech-by-topic")!;
    const byIndustry = data.mentors.find((m) => m.mentor.user_id === "tech-by-industry")!;
    assert.deepEqual(byTopic.topics, ["technology", "product"]);
    assert.deepEqual(byIndustry.industries, ["Technology"]);
  });
});

describe("formatListAvailableMentorsResponse with filters", () => {
  it("headline names the filter and rows include topics", () => {
    const out = formatListAvailableMentorsResponse({
      state: "resolved",
      total_available: 2,
      filters: { topic: "technology", sport: null, position: null },
      mentors: [
        {
          mentor: { name: "Sarah Gallagher", subtitle: "Data Scientist at Meta" },
          open_slots: 4,
          max_mentees: 4,
          current_mentee_count: 0,
          topics: ["technology", "product"],
          sports: ["Football"],
          positions: ["Kicker"],
        },
      ],
    })!;
    assert.match(out, /mentors available for "technology"/);
    assert.match(out, /Topics: technology, product/);
  });

  it("no_results with a filter suggests retrying without it", () => {
    const out = formatListAvailableMentorsResponse({
      state: "no_results",
      total_available: 0,
      mentors: [],
      filters: { topic: "law", sport: null, position: null },
    })!;
    assert.match(out, /No available mentors match "law"/);
  });

  it("unfiltered copy is unchanged", () => {
    const out = formatListAvailableMentorsResponse({
      state: "no_results",
      total_available: 0,
      mentors: [],
      filters: { topic: null, sport: null, position: null },
    })!;
    assert.equal(out, "There are no mentors currently available for new mentees right now.");
  });
});

/* ── pass-2 truncation handling (source asserts) ───────────────────────────── */

describe("pass-2 truncation safeguards", () => {
  it("response composer surfaces finish_reason=length instead of dropping it", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../src/lib/ai/response-composer.ts", import.meta.url),
      "utf8",
    );
    assert.match(src, /event\.reason === "length"/);
    assert.match(src, /cut short by a length limit/);
    assert.match(src, /response truncated at max_tokens/);
  });

  it("pass-2 token budget default accounts for glm reasoning tokens", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../src/lib/ai/llm.ts", import.meta.url), "utf8");
    assert.match(src, /envInt\("AI_PASS2_MAX_TOKENS", 4000\)/);
  });
});
