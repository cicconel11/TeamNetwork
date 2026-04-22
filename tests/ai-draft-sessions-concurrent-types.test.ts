/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearDraftSession,
  getDraftSession,
  saveDraftSession,
  type DraftSessionRecord,
  type DraftSessionType,
} from "@/lib/ai/draft-sessions";

// ─── Stub shape ────────────────────────────────────────────────────────
//
// The wrapper in src/lib/ai/draft-sessions.ts calls:
//   supabase.from("ai_draft_sessions")
//     .select("*").eq(...).eq(...).eq(...)[.eq("draft_type", ...)]
//     .order("updated_at", { ascending: false }).limit(1).maybeSingle()
//   .insert(payload).select("*").single()
//   .update(payload).eq("id", ...).select("*")
//   .delete().eq(...).eq(...).eq(...)[.eq("draft_type", ...)][.eq("pending_action_id", ...)]
//
// This stub implements that shape with an in-memory rows array so we can
// exercise the widened unique-key semantics end-to-end.

type DraftRow = DraftSessionRecord;

interface StubState {
  rows: DraftRow[];
  nextId: number;
}

function buildStub(state: StubState) {
  const matchesEqFilters = (row: DraftRow, filters: Array<{ col: string; val: unknown }>) =>
    filters.every(({ col, val }) => (row as any)[col] === val);

  return {
    from(table: string) {
      if (table !== "ai_draft_sessions") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select(_cols: string) {
          void _cols;
          const filters: Array<{ col: string; val: unknown }> = [];
          let ordered = false;
          let limitCount = Number.POSITIVE_INFINITY;

          const chain: any = {
            eq(col: string, val: unknown) {
              filters.push({ col, val });
              return chain;
            },
            order(_col: string, _opts: { ascending: boolean }) {
              void _col;
              void _opts;
              ordered = true;
              return chain;
            },
            limit(count: number) {
              limitCount = count;
              return chain;
            },
            maybeSingle() {
              const matching = state.rows.filter((r) => matchesEqFilters(r, filters));
              if (ordered) {
                matching.sort(
                  (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
                );
              }
              const capped = matching.slice(0, limitCount);
              if (capped.length === 0) {
                return Promise.resolve({ data: null, error: null });
              }
              if (capped.length > 1) {
                // Mirrors Supabase's .maybeSingle() contract: errors when >1 row.
                return Promise.resolve({
                  data: null,
                  error: { message: "multiple rows returned" },
                });
              }
              return Promise.resolve({ data: capped[0], error: null });
            },
          };
          return chain;
        },
        insert(payload: Record<string, unknown>) {
          const row: DraftRow = {
            id: `row-${state.nextId++}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...(payload as any),
          } as DraftRow;
          state.rows.push(row);
          return {
            select(_c: string) {
              void _c;
              return {
                single: () => Promise.resolve({ data: row, error: null }),
              };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          const filters: Array<{ col: string; val: unknown }> = [];
          const chain: any = {
            eq(col: string, val: unknown) {
              filters.push({ col, val });
              return chain;
            },
            select(_c: string) {
              void _c;
              const matches = state.rows.filter((r) => matchesEqFilters(r, filters));
              for (const row of matches) {
                Object.assign(row, payload, { updated_at: new Date().toISOString() });
              }
              return Promise.resolve({ data: matches, error: null });
            },
          };
          return chain;
        },
        delete() {
          const filters: Array<{ col: string; val: unknown }> = [];
          const chain: any = {
            eq(col: string, val: unknown) {
              filters.push({ col, val });
              // Delete only runs on await — but `.eq()` is chained; Supabase's
              // delete chain resolves the promise on the last `.eq()`. The
              // wrapper awaits the chain directly, which triggers the `then`
              // at whatever the last call is. We implement by making the
              // chain itself thenable after enough eq() calls.
              return chain;
            },
            then(resolve: (v: { error: unknown }) => void) {
              state.rows = state.rows.filter((r) => !matchesEqFilters(r, filters));
              resolve({ error: null });
              return Promise.resolve({ error: null });
            },
          };
          return chain;
        },
      };
    },
  };
}

function freshState(): StubState {
  return { rows: [], nextId: 1 };
}

const orgId = "org-1";
const userId = "user-1";
const threadId = "thread-1";

const saveBaseInput = (draftType: DraftSessionType, extras: Record<string, unknown> = {}) => ({
  organizationId: orgId,
  userId,
  threadId,
  draftType,
  status: "collecting_fields" as const,
  draftPayload: { marker: `draft-${draftType}` } as any,
  missingFields: [],
  pendingActionId: null,
  ...extras,
});

// ─── Tests ──────────────────────────────────────────────────────────────

describe("ai_draft_sessions — concurrent draft types on one thread", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("saveDraftSession inserts two separate rows when (thread, draft_type) differs", async () => {
    const stub = buildStub(state);
    await saveDraftSession(stub as any, saveBaseInput("create_announcement"));
    await saveDraftSession(stub as any, saveBaseInput("create_event"));

    assert.equal(state.rows.length, 2, "two distinct draft types should round-trip as two rows");
    const types = state.rows.map((r) => r.draft_type).sort();
    assert.deepEqual(types, ["create_announcement", "create_event"]);
  });

  it("saveDraftSession updates in place when the same (thread, draft_type) is saved twice", async () => {
    const stub = buildStub(state);
    await saveDraftSession(stub as any, saveBaseInput("create_announcement"));
    await saveDraftSession(
      stub as any,
      saveBaseInput("create_announcement", { draftPayload: { marker: "v2" } })
    );

    assert.equal(state.rows.length, 1, "same type should update, not insert");
    assert.deepEqual(state.rows[0].draft_payload, { marker: "v2" });
  });

  it("getDraftSession with draftType narrows to the matching row", async () => {
    const stub = buildStub(state);
    await saveDraftSession(stub as any, saveBaseInput("create_announcement"));
    await saveDraftSession(stub as any, saveBaseInput("create_event"));

    const ann = await getDraftSession(stub as any, {
      organizationId: orgId,
      userId,
      threadId,
      draftType: "create_announcement",
    });
    assert.ok(ann, "announcement draft must exist");
    assert.equal(ann!.draft_type, "create_announcement");

    const evt = await getDraftSession(stub as any, {
      organizationId: orgId,
      userId,
      threadId,
      draftType: "create_event",
    });
    assert.ok(evt, "event draft must exist");
    assert.equal(evt!.draft_type, "create_event");
  });

  it("getDraftSession without draftType returns the most-recently-updated row (legacy back-compat)", async () => {
    const stub = buildStub(state);
    await saveDraftSession(stub as any, saveBaseInput("create_announcement"));
    // Advance clock by forcing a distinct updated_at on the second save.
    await new Promise((r) => setTimeout(r, 5));
    await saveDraftSession(stub as any, saveBaseInput("create_event"));

    const any = await getDraftSession(stub as any, {
      organizationId: orgId,
      userId,
      threadId,
    });
    assert.ok(any, "should return the most-recent draft regardless of type");
    assert.equal(any!.draft_type, "create_event", "create_event was saved second → most recent");
  });

  it("clearDraftSession with draftType removes only the matching row", async () => {
    const stub = buildStub(state);
    await saveDraftSession(stub as any, saveBaseInput("create_announcement"));
    await saveDraftSession(stub as any, saveBaseInput("create_event"));

    await clearDraftSession(stub as any, {
      organizationId: orgId,
      userId,
      threadId,
      draftType: "create_announcement",
    });

    assert.equal(state.rows.length, 1, "event draft must remain");
    assert.equal(state.rows[0].draft_type, "create_event");
  });

  it("clearDraftSession without draftType removes every draft type for that thread", async () => {
    const stub = buildStub(state);
    await saveDraftSession(stub as any, saveBaseInput("create_announcement"));
    await saveDraftSession(stub as any, saveBaseInput("create_event"));

    await clearDraftSession(stub as any, {
      organizationId: orgId,
      userId,
      threadId,
    });

    assert.equal(state.rows.length, 0, "blanket clear should wipe every type");
  });
});
