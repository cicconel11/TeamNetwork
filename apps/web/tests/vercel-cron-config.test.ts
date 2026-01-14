import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

type CronEntry = {
  path: string;
  schedule: string;
};

test("calendar sync cron runs hourly", () => {
  const raw = readFileSync("vercel.json", "utf8");
  const parsed = JSON.parse(raw) as { crons?: CronEntry[] };
  const cron = parsed.crons?.find((entry) => entry.path === "/api/cron/calendar-sync");

  assert.ok(cron, "Missing /api/cron/calendar-sync cron config");
  assert.strictEqual(cron?.schedule, "0 * * * *");
});
