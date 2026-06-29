import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listEventsModule } from "../src/lib/ai/tools/registry/list-events.ts";

const ORG_ID = "org-1";
const USER_ID = "user-1";

type Row = Record<string, unknown>;

// Chainable query-builder stub: every builder method returns the chain, and the
// chain is awaitable via `then` (resolves the seeded rows). Filters are ignored
// — these tests assert on the tool's MAP/PROJECT behavior, not query semantics.
function makeStubSb(rows: Row[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit", "gte", "lt"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: { data: Row[]; error: null }) => void) => {
    resolve({ data: rows, error: null });
  };
  return { from: () => chain };
}

const ctx = {
  orgId: ORG_ID,
  userId: USER_ID,
  serviceSupabase: null as never,
  authorization: { kind: "preverified_admin", source: "ai_org_context" } as const,
};

const logContext = { requestId: "req-1", route: "test" } as never;

async function execute(args: Record<string, unknown>, rows: Row[]) {
  const parsed = listEventsModule.argsSchema.parse(args);
  return listEventsModule.execute(parsed as never, {
    ctx: ctx as never,
    sb: makeStubSb(rows) as never,
    logContext,
    actorRole: "admin",
  } as never);
}

const LONG_DESC = "x".repeat(900);

const EVENT_ROW = {
  id: "e1",
  title: "Alumni Picnic",
  start_date: "2026-07-01T12:00:00.000Z",
  end_date: "2026-07-01T15:00:00.000Z",
  location: "Park",
  description: LONG_DESC,
};

describe("list_events — body truncation", () => {
  it("truncates description to a 500-char description_preview and drops raw description", async () => {
    const result = await execute({}, [EVENT_ROW]);
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const rows = result.data as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal("description" in row, false);
    assert.equal(typeof row.description_preview, "string");
    assert.equal((row.description_preview as string).length, 500);
    // verifier-required fields survive
    assert.equal(row.title, "Alumni Picnic");
    assert.equal(row.start_date, "2026-07-01T12:00:00.000Z");
  });

  it("returns description_preview = null for blank/empty descriptions", async () => {
    const result = await execute({}, [{ ...EVENT_ROW, description: "   " }]);
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const row = (result.data as Array<Record<string, unknown>>)[0];
    assert.equal(row.description_preview, null);
  });
});

describe("list_events — fields projection", () => {
  it("returns all event fields when fields omitted", async () => {
    const result = await execute({}, [EVENT_ROW]);
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const row = (result.data as Array<Record<string, unknown>>)[0];
    assert.deepEqual(Object.keys(row).sort(), [
      "description_preview",
      "end_date",
      "id",
      "location",
      "start_date",
      "title",
    ]);
  });

  it("returns only requested fields when fields provided", async () => {
    const result = await execute({ fields: ["title", "start_date"] }, [EVENT_ROW]);
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const row = (result.data as Array<Record<string, unknown>>)[0];
    assert.deepEqual(row, {
      title: "Alumni Picnic",
      start_date: "2026-07-01T12:00:00.000Z",
    });
  });

  it("rejects an invalid field name at the schema boundary", () => {
    assert.throws(() => listEventsModule.argsSchema.parse({ fields: ["bogus"] }));
  });

  it("rejects an empty fields array at the schema boundary", () => {
    assert.throws(() => listEventsModule.argsSchema.parse({ fields: [] }));
  });

  it("rejects unknown top-level args (strict)", () => {
    assert.throws(() => listEventsModule.argsSchema.parse({ extra: 1 }));
  });
});
