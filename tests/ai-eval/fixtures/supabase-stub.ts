/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Minimal Supabase stub for the eval harness — modeled on
 * `tests/routes/ai/chat-handler-tools.test.ts`. Just enough surface area to
 * let `createChatPostHandler` round-trip a single turn and write an audit
 * entry without touching a real Postgres.
 *
 * Cases that need richer DB state should layer their own state on top of the
 * `state` returned here, not edit this stub.
 */

export const ORG_ID = "11111111-1111-4111-8111-aaaaaaaaaaaa";
export const ADMIN_USER = { id: "22222222-2222-4222-8222-bbbbbbbbbbbb", email: "admin@example.com" };
export const VALID_IDEMPOTENCY_KEY = "33333333-3333-4333-8333-cccccccccccc";

export interface SupabaseStubState {
  threadCount: number;
  assistantCount: number;
  threads: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  discussionThreads: Array<Record<string, unknown>>;
}

type FilterKind = "eq" | "in" | "lt" | "gt" | "is" | "ilike";
type Filter = { kind: FilterKind; column: string; value: unknown };

const FILTER_OPS: Record<FilterKind, (rowValue: unknown, filterValue: unknown) => boolean> = {
  eq: (a, b) => a === b,
  is: (a, b) => a === b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
  lt: (a, b) => String(a ?? "") < String(b),
  gt: (a, b) => String(a ?? "") > String(b),
  ilike: (a, b) => {
    if (typeof a !== "string" || typeof b !== "string") return false;
    const pattern = b
      .replace(/([.+^${}()|[\]\\])/g, "\\$1")
      .replace(/%/g, ".*")
      .replace(/_/g, ".");
    return new RegExp(`^${pattern}$`, "i").test(a);
  },
};

function applyFilters(rows: Array<Record<string, unknown>>, filters: Filter[]) {
  return rows.filter((row) =>
    filters.every((f) => FILTER_OPS[f.kind](row[f.column], f.value))
  );
}

export function createSupabaseStub() {
  const state: SupabaseStubState = {
    threadCount: 0,
    assistantCount: 0,
    threads: [],
    messages: [],
    discussionThreads: [],
  };

  function from(table: string) {
    const query = {
      table,
      op: "select" as "select" | "insert" | "update",
      inserted: null as Record<string, unknown> | null,
      updated: null as Record<string, unknown> | null,
      filters: [] as Filter[],
      orderBy: null as { column: string; ascending: boolean } | null,
      limitValue: null as number | null,
      singleMode: null as "single" | "maybeSingle" | null,
    };

    const builder: Record<string, any> = {
      select() { return builder; },
      insert(payload: Record<string, unknown>) { query.op = "insert"; query.inserted = payload; return builder; },
      update(payload: Record<string, unknown>) { query.op = "update"; query.updated = payload; return builder; },
      eq(column: string, value: unknown) { query.filters.push({ kind: "eq", column, value }); return builder; },
      is(column: string, value: unknown) { query.filters.push({ kind: "is", column, value }); return builder; },
      ilike(column: string, value: string) { query.filters.push({ kind: "ilike", column, value }); return builder; },
      in(column: string, value: unknown[]) { query.filters.push({ kind: "in", column, value }); return builder; },
      lt(column: string, value: unknown) { query.filters.push({ kind: "lt", column, value }); return builder; },
      gt(column: string, value: unknown) { query.filters.push({ kind: "gt", column, value }); return builder; },
      order(column: string, opts?: { ascending?: boolean }) { query.orderBy = { column, ascending: opts?.ascending ?? true }; return builder; },
      limit(value: number) { query.limitValue = value; return builder; },
    };

    const resolve = () => {
      if (table === "ai_messages") {
        if (query.op === "select") {
          let rows = applyFilters(state.messages, query.filters);
          if (query.orderBy) {
            rows = [...rows].sort((a, b) => {
              const left = String(a[query.orderBy!.column] ?? "");
              const right = String(b[query.orderBy!.column] ?? "");
              return query.orderBy!.ascending ? left.localeCompare(right) : right.localeCompare(left);
            });
          }
          if (typeof query.limitValue === "number") rows = rows.slice(0, query.limitValue);
          return {
            data: query.filters.some((f) => f.kind === "eq" && f.column === "idempotency_key")
              ? (rows[0] ?? null)
              : rows,
            error: null,
          };
        }
        if (query.op === "insert" && query.inserted?.role === "assistant") {
          const id = `assistant-${++state.assistantCount}`;
          state.messages.push({ id, ...query.inserted });
          return { data: { id }, error: null };
        }
        if (query.op === "insert") {
          state.messages.push({ id: `user-${state.messages.length + 1}`, ...query.inserted, created_at: new Date().toISOString() });
          return { data: null, error: null };
        }
        if (query.op === "update") {
          for (const row of state.messages) {
            if (applyFilters([row], query.filters).length === 1) Object.assign(row, query.updated!);
          }
          return { data: null, error: null };
        }
      }

      if (table === "organizations" && query.op === "select") {
        return { data: { slug: "acme" }, error: null };
      }

      return { data: null, error: null };
    };

    builder.maybeSingle = async () => { query.singleMode = "maybeSingle"; return resolve(); };
    builder.single = async () => { query.singleMode = "single"; return resolve(); };
    builder.then = (onFulfilled: any, onRejected?: any) => Promise.resolve(resolve()).then(onFulfilled, onRejected);
    return builder;
  }

  return {
    auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
    from,
    state,
  };
}

export type SupabaseStub = ReturnType<typeof createSupabaseStub>;
