import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { searchOrgContentModule } from "../src/lib/ai/tools/registry/search-org-content.ts";

const ctx = {
  orgId: "org-1",
  orgSlug: "acme",
  userId: "user-1",
  serviceSupabase: null as never,
  authorization: { kind: "preverified_admin", source: "ai_org_context" } as const,
};

const logContext = { requestId: "req-search-1", route: "test" } as never;

function createStubSb(options: {
  rpcRows?: Array<Record<string, unknown>>;
  announcementRows?: Array<Record<string, unknown>>;
  eventRows?: Array<Record<string, unknown>>;
}) {
  const queriedTables: string[] = [];

  return {
    queriedTables,
    sb: {
      rpc(fn: string, args: Record<string, unknown>) {
        assert.equal(fn, "search_org_content");
        assert.deepEqual(args, {
          p_org_id: "org-1",
          p_org_slug: "acme",
          p_query: args.p_query,
          p_limit: args.p_limit,
        });
        return Promise.resolve({
          data: options.rpcRows ?? [],
          error: null,
        });
      },
      from(table: string) {
        queriedTables.push(table);
        const rows =
          table === "announcements"
            ? (options.announcementRows ?? [])
            : table === "events"
              ? (options.eventRows ?? [])
              : [];
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq", "is", "or", "order", "limit"]) {
          chain[method] = () => chain;
        }
        chain.then = (resolve: (value: unknown) => void) =>
          resolve({ data: rows, error: null });
        return chain;
      },
    },
  };
}

async function execute(
  args: { query: string; limit?: number },
  stub: ReturnType<typeof createStubSb>,
) {
  const parsed = searchOrgContentModule.argsSchema.parse(args);
  const result = await searchOrgContentModule.execute(parsed as never, {
    ctx: ctx as never,
    sb: stub.sb as never,
    logContext,
  });
  return result;
}

describe("search_org_content fallback gating", () => {
  it("skips fallback reads when RPC already satisfies the requested limit", async () => {
    const stub = createStubSb({
      rpcRows: Array.from({ length: 5 }, (_, index) => ({
        entity_type: "announcement",
        entity_id: `a-${index}`,
        title: `Announcement ${index}`,
        snippet: "Body",
        url_path: "/acme/announcements",
        rank: 0.9,
        metadata: {},
      })),
    });

    const result = await execute({ query: "search announcements about gala", limit: 5 }, stub);
    assert.equal(result.kind, "ok");
    assert.deepEqual(stub.queriedTables, []);
  });

  it("runs fallback reads when RPC returns too few rows", async () => {
    const stub = createStubSb({
      rpcRows: [],
      announcementRows: [
        {
          id: "ann-1",
          title: "Fundraising kickoff",
          body: "Picnic planning starts now",
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
    });

    const result = await execute({ query: "search announcements about picnic" }, stub);
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const rows = result.data as Array<Record<string, unknown>>;
    assert.equal(rows[0]?.entity_type, "announcement");
    assert.equal(rows[0]?.url_path, "/acme/announcements");
    assert.deepEqual(stub.queriedTables, ["announcements", "events"]);
  });

  it("runs fallback reads when the requested content type is missing from RPC rows", async () => {
    const stub = createStubSb({
      rpcRows: [
        {
          entity_type: "event",
          entity_id: "evt-1",
          title: "Team picnic",
          snippet: "Main quad",
          url_path: "/acme/calendar/events/evt-1",
          rank: 0.8,
          metadata: {},
        },
      ],
      announcementRows: [
        {
          id: "ann-2",
          title: "Picnic volunteers",
          body: "Need a few more parents",
          created_at: "2026-04-02T00:00:00.000Z",
        },
      ],
    });

    const result = await execute({ query: "find announcements about picnic", limit: 10 }, stub);
    assert.equal(result.kind, "ok");
    assert.deepEqual(stub.queriedTables, ["announcements", "events"]);
    if (result.kind !== "ok") return;
    const rows = result.data as Array<Record<string, unknown>>;
    assert.ok(rows.some((row) => row.entity_type === "announcement"));
  });
});
