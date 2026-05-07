import test from "node:test";
import assert from "node:assert/strict";
import { softDeleteMediaItems } from "@/lib/media/delete-media";

type QueryResult = { data?: unknown; error?: unknown };
type QueryHandler = (query: {
  table: string;
  operation: "select" | "update" | "delete";
  payload?: Record<string, unknown>;
  columns?: string;
  filters: Array<{ type: "eq" | "in" | "is"; column: string; value: unknown }>;
}) => Promise<QueryResult> | QueryResult;

class MockQuery {
  private operation: "select" | "update" | "delete" | null = null;
  private payload: Record<string, unknown> | undefined;
  private columns: string | undefined;
  private filters: Array<{ type: "eq" | "in" | "is"; column: string; value: unknown }> = [];

  constructor(
    private readonly table: string,
    private readonly handlers: Map<string, QueryHandler>,
    private readonly calls: Array<{
      table: string;
      operation: "select" | "update" | "delete";
      payload?: Record<string, unknown>;
      columns?: string;
      filters: Array<{ type: "eq" | "in" | "is"; column: string; value: unknown }>;
    }>,
  ) {}

  select(columns: string) {
    if (!this.operation) {
      this.operation = "select";
    }
    this.columns = columns;
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  in(column: string, value: unknown) {
    this.filters.push({ type: "in", column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ type: "is", column, value });
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    const query = {
      table: this.table,
      operation: (this.operation ?? "select") as "select" | "update" | "delete",
      payload: this.payload,
      columns: this.columns,
      filters: this.filters,
    };

    this.calls.push(query);
    const handler = this.handlers.get(`${query.table}:${query.operation}`);
    const result = handler ? Promise.resolve(handler(query)) : Promise.resolve({ data: null, error: null });
    return result.then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function createMockServiceClient(handlers: Record<string, QueryHandler>) {
  const calls: Array<{
    table: string;
    operation: "select" | "update" | "delete";
    payload?: Record<string, unknown>;
    columns?: string;
    filters: Array<{ type: "eq" | "in" | "is"; column: string; value: unknown }>;
  }> = [];
  const handlerMap = new Map(Object.entries(handlers));

  return {
    calls,
    client: {
      from(table: string) {
        return new MockQuery(table, handlerMap, calls);
      },
    },
  };
}

test("softDeleteMediaItems removes deleted media from albums so trigger-backed counts stay correct", async () => {
  const { client, calls } = createMockServiceClient({
    "media_items:select": async () => ({
      data: [
        { id: "media-1", uploaded_by: "user-1" },
        { id: "media-2", uploaded_by: "user-1" },
      ],
      error: null,
    }),
    "media_albums:update": async () => ({ data: null, error: null }),
    "media_items:update": async () => ({
      data: [{ id: "media-1" }, { id: "media-2" }],
      error: null,
    }),
    "media_album_items:delete": async () => ({ data: null, error: null }),
  });

  const result = await softDeleteMediaItems(client as never, {
    orgId: "org-1",
    mediaIds: ["media-1", "media-2"],
    actor: { isAdmin: false, userId: "user-1" },
    forbiddenMessage: "Forbidden",
    now: "2026-04-01T12:00:00.000Z",
  });

  assert.deepEqual(result, { ok: true, deletedIds: ["media-1", "media-2"] });

  const membershipDelete = calls.find(
    (call) => call.table === "media_album_items" && call.operation === "delete",
  );
  assert.ok(membershipDelete, "soft delete should remove deleted media from album memberships");
  assert.deepEqual(
    membershipDelete?.filters.find((filter) => filter.type === "in" && filter.column === "media_item_id")?.value,
    ["media-1", "media-2"],
  );
});

test("softDeleteMediaItems only removes album memberships for rows that were actually soft-deleted", async () => {
  const { client, calls } = createMockServiceClient({
    "media_albums:update": async () => ({ data: null, error: null }),
    "media_items:update": async () => ({
      data: [{ id: "media-2" }],
      error: null,
    }),
    "media_album_items:delete": async () => ({ data: null, error: null }),
  });

  const result = await softDeleteMediaItems(client as never, {
    orgId: "org-1",
    mediaIds: ["media-1", "media-2"],
    actor: { isAdmin: true, userId: "admin-1" },
    forbiddenMessage: "Forbidden",
    now: "2026-04-01T12:00:00.000Z",
  });

  assert.deepEqual(result, { ok: true, deletedIds: ["media-2"] });

  const membershipDelete = calls.find(
    (call) => call.table === "media_album_items" && call.operation === "delete",
  );
  assert.ok(membershipDelete, "album membership cleanup should still run for deleted rows");
  assert.deepEqual(
    membershipDelete?.filters.find((filter) => filter.type === "in" && filter.column === "media_item_id")?.value,
    ["media-2"],
  );
});

