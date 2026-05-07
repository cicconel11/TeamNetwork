/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_PENDING_ACTION_MAX_REVISES,
  updatePendingActionPayload,
  type PendingActionPayload,
  type PendingActionRecord,
} from "../src/lib/ai/pending-actions.ts";

type Row = PendingActionRecord;

function createSupabase(rows: Row[]) {
  return {
    from(table: string) {
      assert.equal(table, "ai_pending_actions");

      return {
        select(columns: string) {
          void columns;
          const filters: Array<{ column: string; value: string | number }> = [];
          const builder: any = {
            eq(column: string, value: string | number) {
              filters.push({ column, value });
              return builder;
            },
            maybeSingle() {
              const match = rows.find((row) =>
                filters.every((f) => (row as any)[f.column] === f.value)
              );
              return Promise.resolve({ data: match ?? null, error: null });
            },
          };
          return builder;
        },
        update(patch: Record<string, unknown>) {
          const filters: Array<{ column: string; value: string | number }> = [];
          const chain: any = {
            eq(column: string, value: string | number) {
              filters.push({ column, value });
              return chain;
            },
            async select(columns: string) {
              void columns;
              const matched = rows.filter((row) =>
                filters.every((f) => (row as any)[f.column] === f.value)
              );
              for (const row of matched) {
                Object.assign(row, patch);
              }
              return {
                data: matched.map((row) => ({ id: row.id })),
                error: null,
              };
            },
          };
          return chain;
        },
      };
    },
  };
}

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "action-1",
    organization_id: "org-1",
    user_id: "user-1",
    thread_id: "thread-1",
    action_type: "create_announcement",
    payload: { title: "v1", body: "body v1" } as any,
    previous_payload: null,
    revise_count: 0,
    status: "pending",
    expires_at: "2026-04-23T01:00:00.000Z",
    created_at: "2026-04-23T00:00:00.000Z",
    updated_at: "2026-04-23T00:00:00.000Z",
    executed_at: null,
    error_message: null,
    result_entity_type: null,
    result_entity_id: null,
    ...overrides,
  };
}

const newPayload: PendingActionPayload = { title: "v2", body: "body v2" } as any;
const prevPayload: PendingActionPayload = { title: "v1", body: "body v1" } as any;

test("first revise: revise_count 0 -> 1, payload and previous_payload update", async () => {
  const rows = [makeRow()];
  const supabase = createSupabase(rows);

  const result = await updatePendingActionPayload(supabase as any, "action-1", {
    newPayload,
    previousPayload: prevPayload,
    expectedReviseCount: 0,
  });

  assert.equal(result.updated, true);
  if (result.updated) {
    assert.equal(result.row.revise_count, 1);
    assert.deepEqual(result.row.payload, newPayload);
    assert.deepEqual(result.row.previous_payload, prevPayload);
  }
});

test("second revise: 1 -> 2", async () => {
  const rows = [makeRow({ revise_count: 1, payload: newPayload, previous_payload: prevPayload })];
  const supabase = createSupabase(rows);

  const payload3: PendingActionPayload = { title: "v3", body: "body v3" } as any;
  const result = await updatePendingActionPayload(supabase as any, "action-1", {
    newPayload: payload3,
    previousPayload: newPayload,
    expectedReviseCount: 1,
  });

  assert.equal(result.updated, true);
  if (result.updated) assert.equal(result.row.revise_count, 2);
});

test("third revise: 2 -> 3 (at cap, still succeeds)", async () => {
  const rows = [makeRow({ revise_count: 2 })];
  const supabase = createSupabase(rows);

  const result = await updatePendingActionPayload(supabase as any, "action-1", {
    newPayload,
    previousPayload: prevPayload,
    expectedReviseCount: 2,
  });

  assert.equal(result.updated, true);
  if (result.updated) assert.equal(result.row.revise_count, AI_PENDING_ACTION_MAX_REVISES);
});

test("fourth revise rejected: revise_count = 3 -> returns revise_limit without DB write", async () => {
  const rows = [makeRow({ revise_count: AI_PENDING_ACTION_MAX_REVISES })];
  const supabase = createSupabase(rows);

  const result = await updatePendingActionPayload(supabase as any, "action-1", {
    newPayload,
    previousPayload: prevPayload,
    expectedReviseCount: AI_PENDING_ACTION_MAX_REVISES,
  });

  assert.equal(result.updated, false);
  if (!result.updated) assert.equal(result.reason, "revise_limit");
  // Row unchanged
  assert.equal(rows[0].revise_count, AI_PENDING_ACTION_MAX_REVISES);
  assert.deepEqual(rows[0].payload, { title: "v1", body: "body v1" });
});

test("revise rejected when row is cancelled", async () => {
  const rows = [makeRow({ status: "cancelled" })];
  const supabase = createSupabase(rows);

  const result = await updatePendingActionPayload(supabase as any, "action-1", {
    newPayload,
    previousPayload: prevPayload,
    expectedReviseCount: 0,
  });

  assert.equal(result.updated, false);
  if (!result.updated) assert.equal(result.reason, "not_pending");
});

test("revise rejected when row is executed (user approved concurrently)", async () => {
  const rows = [makeRow({ status: "executed" })];
  const supabase = createSupabase(rows);

  const result = await updatePendingActionPayload(supabase as any, "action-1", {
    newPayload,
    previousPayload: prevPayload,
    expectedReviseCount: 0,
  });

  assert.equal(result.updated, false);
  if (!result.updated) assert.equal(result.reason, "not_pending");
});

test("revise rejected when action_id is unknown", async () => {
  const supabase = createSupabase([]);

  const result = await updatePendingActionPayload(supabase as any, "missing-action", {
    newPayload,
    previousPayload: prevPayload,
    expectedReviseCount: 0,
  });

  assert.equal(result.updated, false);
  if (!result.updated) assert.equal(result.reason, "not_found");
});

test("concurrent revise conflict: expectedReviseCount stale -> conflict reason", async () => {
  // Row is at revise_count=1 already (another revise landed), but caller thinks it's 0.
  const rows = [makeRow({ revise_count: 1 })];
  const supabase = createSupabase(rows);

  const result = await updatePendingActionPayload(supabase as any, "action-1", {
    newPayload,
    previousPayload: prevPayload,
    expectedReviseCount: 0,
  });

  assert.equal(result.updated, false);
  if (!result.updated) assert.equal(result.reason, "conflict");
});
