/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_PENDING_ACTION_MAX_REVISES,
  createOrRevisePendingAction,
  type PendingActionPayload,
  type PendingActionRecord,
} from "../src/lib/ai/pending-actions.ts";

type Row = PendingActionRecord;

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

interface Inserted {
  payload: Record<string, unknown>;
  insertCount: number;
}

function createSupabase(rows: Row[], inserted: Inserted) {
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
              // Real Supabase returns deserialized JSON per call (fresh
              // object). Clone so in-place row mutation does not bleed into
              // a previously-returned snapshot.
              return Promise.resolve({
                data: match ? structuredClone(match) : null,
                error: null,
              });
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
        insert(payload: Record<string, unknown>) {
          inserted.insertCount += 1;
          inserted.payload = payload;
          const inserted_row: Row = {
            id: `inserted-${inserted.insertCount}`,
            organization_id: String(payload.organization_id),
            user_id: String(payload.user_id),
            thread_id: String(payload.thread_id),
            action_type: payload.action_type as Row["action_type"],
            payload: payload.payload as PendingActionPayload,
            previous_payload: (payload.previous_payload as PendingActionPayload | null) ?? null,
            revise_count: 0,
            status: "pending",
            expires_at: String(payload.expires_at),
            created_at: "2026-04-23T00:00:00.000Z",
            updated_at: "2026-04-23T00:00:00.000Z",
            executed_at: null,
            error_message: null,
            result_entity_type: null,
            result_entity_id: null,
          };
          rows.push(inserted_row);
          return {
            select(columns: string) {
              void columns;
              return {
                single() {
                  return Promise.resolve({ data: inserted_row, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

const v1: PendingActionPayload = { title: "v1", body: "body v1" } as any;
const v2: PendingActionPayload = { title: "v2", body: "body v2" } as any;

const baseInput = {
  organizationId: "org-1",
  userId: "user-1",
  threadId: "thread-1",
  actionType: "create_announcement" as const,
};

test("no active id -> straight create, never reads existing rows", async () => {
  const inserted: Inserted = { payload: {}, insertCount: 0 };
  const supabase = createSupabase([], inserted);

  const result = await createOrRevisePendingAction(supabase as any, {
    ...baseInput,
    payload: v1,
  });

  assert.equal(result.revised, false);
  assert.equal(inserted.insertCount, 1);
  assert.equal(result.record.payload, v1);
});

test("active id + matching action_type -> revise in place, no insert", async () => {
  const rows = [makeRow({ payload: v1 })];
  const inserted: Inserted = { payload: {}, insertCount: 0 };
  const supabase = createSupabase(rows, inserted);

  const result = await createOrRevisePendingAction(supabase as any, {
    ...baseInput,
    payload: v2,
    activeActionId: "action-1",
  });

  assert.equal(result.revised, true);
  assert.equal(inserted.insertCount, 0);
  assert.equal(rows[0].revise_count, 1);
  assert.deepEqual(rows[0].payload, v2);
  assert.deepEqual(rows[0].previous_payload, v1);
  if (result.revised) {
    assert.equal(result.reviseCount, 1);
    assert.deepEqual(result.previousPayload, v1);
  }
});

test("active id but mismatched action_type -> falls through to create", async () => {
  const rows = [makeRow({ payload: v1, action_type: "create_event" })];
  const inserted: Inserted = { payload: {}, insertCount: 0 };
  const supabase = createSupabase(rows, inserted);

  const result = await createOrRevisePendingAction(supabase as any, {
    ...baseInput,
    actionType: "create_announcement",
    payload: v2,
    activeActionId: "action-1",
  });

  assert.equal(result.revised, false);
  assert.equal(inserted.insertCount, 1);
  // Original row untouched
  assert.equal(rows[0].revise_count, 0);
  assert.deepEqual(rows[0].payload, v1);
});

test("active id at revise_limit -> falls through to create", async () => {
  const rows = [makeRow({ payload: v1, revise_count: AI_PENDING_ACTION_MAX_REVISES })];
  const inserted: Inserted = { payload: {}, insertCount: 0 };
  const supabase = createSupabase(rows, inserted);

  const result = await createOrRevisePendingAction(supabase as any, {
    ...baseInput,
    payload: v2,
    activeActionId: "action-1",
  });

  assert.equal(result.revised, false);
  assert.equal(inserted.insertCount, 1);
  assert.equal(rows[0].revise_count, AI_PENDING_ACTION_MAX_REVISES);
});

test("active id but row missing -> falls through to create", async () => {
  const inserted: Inserted = { payload: {}, insertCount: 0 };
  const supabase = createSupabase([], inserted);

  const result = await createOrRevisePendingAction(supabase as any, {
    ...baseInput,
    payload: v2,
    activeActionId: "action-stale",
  });

  assert.equal(result.revised, false);
  assert.equal(inserted.insertCount, 1);
});

test("active id but row no longer pending -> falls through to create", async () => {
  const rows = [makeRow({ payload: v1, status: "executed" })];
  const inserted: Inserted = { payload: {}, insertCount: 0 };
  const supabase = createSupabase(rows, inserted);

  const result = await createOrRevisePendingAction(supabase as any, {
    ...baseInput,
    payload: v2,
    activeActionId: "action-1",
  });

  assert.equal(result.revised, false);
  assert.equal(inserted.insertCount, 1);
});

test("create path forwards previousPayload (edit-source snapshot)", async () => {
  const inserted: Inserted = { payload: {}, insertCount: 0 };
  const supabase = createSupabase([], inserted);

  const editSource: PendingActionPayload = { title: "old title", body: "old body" } as any;
  const result = await createOrRevisePendingAction(supabase as any, {
    ...baseInput,
    payload: v2,
    previousPayload: editSource,
  });

  assert.equal(result.revised, false);
  assert.deepEqual(inserted.payload.previous_payload, editSource);
  assert.deepEqual(result.record.previous_payload, editSource);
});
