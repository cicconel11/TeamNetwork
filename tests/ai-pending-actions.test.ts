/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanupStrandedPendingActions,
  updatePendingActionStatus,
} from "../src/lib/ai/pending-actions.ts";

type PendingRow = {
  id: string;
  organization_id: string;
  status: string;
  updated_at: string;
  error_message?: string | null;
};

function createPendingActionSupabase(rows: PendingRow[], raceActionId?: string) {
  return {
    from(table: string) {
      assert.equal(table, "ai_pending_actions");

      return {
        select(columns: string) {
          void columns;
          const filters: Array<{ column: string; value: string }> = [];
          return {
            eq(column: string, value: string) {
              filters.push({ column, value });
              return this;
            },
            lt(column: string, value: string) {
              const data = rows.filter((row) => {
                return filters.every((filter) => String((row as any)[filter.column]) === filter.value) &&
                  String((row as any)[column]) < value;
              });
              return Promise.resolve({ data, error: null });
            },
            maybeSingle() {
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
        update(payload: Record<string, unknown>) {
          const filters: Array<{ column: string; value: string }> = [];
          const chain: any = {
            eq(column: string, value: string) {
              filters.push({ column, value });
              return chain;
            },
            async select(columns: string) {
              void columns;
              const idFilter = filters.find((filter) => filter.column === "id")?.value;
              if (raceActionId && idFilter === raceActionId) {
                const raceRow = rows.find((row) => row.id === raceActionId);
                if (raceRow) raceRow.status = "executed";
              }

              const matched = rows.filter((row) =>
                filters.every((filter) => String((row as any)[filter.column]) === filter.value)
              );

              for (const row of matched) {
                Object.assign(row, payload);
              }

              return {
                data: matched.map((row) => ({ id: row.id })),
                error: null,
              };
            },
            then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
              return chain.select("id").then(onFulfilled, onRejected);
            },
          };

          return chain;
        },
      };
    },
  };
}

test("updatePendingActionStatus non-CAS returns updated false when no row matches", async () => {
  const supabase = createPendingActionSupabase([]);

  const result = await updatePendingActionStatus(supabase as any, "missing-action", {
    status: "cancelled",
  });

  assert.deepEqual(result, { updated: false });
});

test("cleanupStrandedPendingActions recovers stale confirmed rows and CAS-skips a late execution", async () => {
  const cutoff = "2026-03-30T12:00:00.000Z";
  const rows: PendingRow[] = [
    {
      id: "recover-me",
      organization_id: "org-1",
      status: "confirmed",
      updated_at: "2026-03-30T11:50:00.000Z",
    },
    {
      id: "late-execution",
      organization_id: "org-1",
      status: "confirmed",
      updated_at: "2026-03-30T11:49:00.000Z",
    },
    {
      id: "fresh-confirmed",
      organization_id: "org-1",
      status: "confirmed",
      updated_at: "2026-03-30T12:04:00.000Z",
    },
  ];

  const supabase = createPendingActionSupabase(rows, "late-execution");

  const result = await cleanupStrandedPendingActions(supabase as any, {
    organizationId: "org-1",
    olderThanIso: cutoff,
    failureMessage: "Execution timed out after confirmation",
  });

  assert.deepEqual(result, { scanned: 2, recovered: 1, skipped: 1 });
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].error_message, "Execution timed out after confirmation");
  assert.equal(rows[1].status, "executed");
  assert.equal(rows[2].status, "confirmed");
});
