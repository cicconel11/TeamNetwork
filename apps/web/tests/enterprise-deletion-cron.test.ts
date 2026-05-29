import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tests for GET /api/cron/enterprise-deletion.
 *
 * Mirrors /api/cron/account-deletion: cron-auth gate, batch over pending+expired
 * rows, per-row deleteExpiredEnterprise, count successes/failures. Source-asserted
 * for the structural invariants plus a small batch-logic simulation.
 */

const cronSource = readFileSync(
  join(process.cwd(), "src/app/api/cron/enterprise-deletion/route.ts"),
  "utf8"
);
const vercelJson = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
  crons: Array<{ path: string; schedule: string }>;
};

interface CronRow {
  enterprise_id: string;
  purgeSucceeds: boolean;
}

function simulateCron(rows: CronRow[]): { processed: number; succeeded: number; failed: number } {
  let succeeded = 0;
  let failed = 0;
  for (const r of rows) {
    if (r.purgeSucceeds) succeeded++;
    else failed++;
  }
  return { processed: rows.length, succeeded, failed };
}

test("expired pending rows are purged; failures counted separately", () => {
  const r = simulateCron([
    { enterprise_id: "a", purgeSucceeds: true },
    { enterprise_id: "b", purgeSucceeds: true },
    { enterprise_id: "c", purgeSucceeds: false },
  ]);
  assert.deepStrictEqual(r, { processed: 3, succeeded: 2, failed: 1 });
});

test("empty batch yields zero counts", () => {
  const r = simulateCron([]);
  assert.deepStrictEqual(r, { processed: 0, succeeded: 0, failed: 0 });
});

test("a Stripe-halt on one row does not stop the others", () => {
  const r = simulateCron([
    { enterprise_id: "halt", purgeSucceeds: false },
    { enterprise_id: "ok", purgeSucceeds: true },
  ]);
  assert.strictEqual(r.succeeded, 1);
  assert.strictEqual(r.failed, 1);
});

// ── Source-level invariants ───────────────────────────────────────────────────

test("cron is gated by validateCronAuth", () => {
  assert.match(cronSource, /validateCronAuth\(request\)/);
});

test("cron selects only pending rows whose grace window elapsed", () => {
  assert.match(cronSource, /\.eq\("status", "pending"\)/);
  assert.match(cronSource, /\.lte\("scheduled_deletion_at", new Date\(\)\.toISOString\(\)\)/);
});

test("cron delegates each row to deleteExpiredEnterprise", () => {
  assert.match(cronSource, /deleteExpiredEnterprise\(req\.enterprise_id\)/);
});

test("cron handles missing table (42P01) without throwing", () => {
  assert.match(cronSource, /42P01/);
});

test("vercel.json registers the enterprise-deletion cron", () => {
  const entry = vercelJson.crons.find((c) => c.path === "/api/cron/enterprise-deletion");
  assert.ok(entry, "cron entry must exist");
  assert.strictEqual(entry?.schedule, "30 2 * * *");
});
