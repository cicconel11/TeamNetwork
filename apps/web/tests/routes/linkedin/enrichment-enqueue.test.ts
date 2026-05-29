import test from "node:test";
import assert from "node:assert/strict";
import { enqueueAlumniForEnrichment } from "@/lib/linkedin/enrichment-writeback";

interface RecordedCall {
  table: string;
  update: Record<string, unknown> | null;
  filters: unknown[][];
}

// Minimal mock of the supabase query builder used by enqueueAlumniForEnrichment.
// Each terminal .select() resolves to one chunk's "updated" rows.
function makeMock(selectResults: Array<{ id: string }[]>) {
  const calls: RecordedCall[] = [];
  let selectIndex = 0;
  const client = {
    from(table: string) {
      const call: RecordedCall = { table, update: null, filters: [] };
      calls.push(call);
      const builder = {
        update(u: Record<string, unknown>) {
          call.update = u;
          return builder;
        },
        eq(c: string, v: unknown) {
          call.filters.push(["eq", c, v]);
          return builder;
        },
        in(c: string, v: unknown) {
          call.filters.push(["in", c, v]);
          return builder;
        },
        not(c: string, o: string, v: unknown) {
          call.filters.push(["not", c, o, v]);
          return builder;
        },
        or(expr: string) {
          call.filters.push(["or", expr]);
          return builder;
        },
        select() {
          const rows = selectResults[selectIndex] ?? [];
          selectIndex += 1;
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  };
  return { client, calls };
}

test("enqueueAlumniForEnrichment is a no-op for an empty id list", async () => {
  const { client, calls } = makeMock([]);
  const result = await enqueueAlumniForEnrichment(client as never, "org-1", []);
  assert.deepEqual(result, { enqueued: 0 });
  assert.equal(calls.length, 0);
});

test("enqueueAlumniForEnrichment marks rows pending, scoped to the org, and counts updated rows", async () => {
  const { client, calls } = makeMock([[{ id: "a1" }, { id: "a2" }]]);
  const result = await enqueueAlumniForEnrichment(client as never, "org-1", ["a1", "a2", "a3"]);

  assert.deepEqual(result, { enqueued: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, "alumni");
  assert.equal(calls[0].update?.enrichment_status, "pending");
  assert.equal(calls[0].update?.enrichment_retry_count, 0);
  assert.equal(calls[0].update?.enrichment_error, null);

  // Scoped to the org, only URL-bearing + not-yet-enriched rows, by id list.
  assert.ok(calls[0].filters.some((f) => f[0] === "eq" && f[1] === "organization_id" && f[2] === "org-1"));
  assert.ok(calls[0].filters.some((f) => f[0] === "not" && f[1] === "linkedin_url"));
  assert.ok(calls[0].filters.some((f) => f[0] === "or"));
  const inFilter = calls[0].filters.find((f) => f[0] === "in");
  assert.deepEqual(inFilter?.[2], ["a1", "a2", "a3"]);
});

test("enqueueAlumniForEnrichment dedupes ids and chunks large lists", async () => {
  // 250 unique ids (+ a duplicate) -> 2 chunks of 200 + 50.
  const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
  ids.push("id-0"); // duplicate, should be collapsed
  const { client, calls } = makeMock([
    Array.from({ length: 200 }, (_, i) => ({ id: `id-${i}` })),
    Array.from({ length: 50 }, (_, i) => ({ id: `id-${200 + i}` })),
  ]);

  const result = await enqueueAlumniForEnrichment(client as never, "org-1", ids);

  assert.equal(calls.length, 2, "should issue one update per 200-id chunk");
  assert.equal(result.enqueued, 250);
  const firstIn = calls[0].filters.find((f) => f[0] === "in");
  assert.equal((firstIn?.[2] as string[]).length, 200);
});
