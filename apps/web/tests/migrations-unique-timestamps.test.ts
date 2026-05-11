import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";

test("20261203 Supabase migration timestamps are unique", () => {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const timestampsByFile = readdirSync(migrationsDir)
    .filter((file) => file.startsWith("20261203") && file.endsWith(".sql"))
    .map((file) => ({ file, timestamp: file.slice(0, 14) }));

  const filesByTimestamp = new Map<string, string[]>();
  for (const { file, timestamp } of timestampsByFile) {
    const files = filesByTimestamp.get(timestamp) ?? [];
    files.push(file);
    filesByTimestamp.set(timestamp, files);
  }

  const duplicates = [...filesByTimestamp.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([timestamp, files]) => `${timestamp}: ${files.sort().join(", ")}`);

  assert.deepEqual(duplicates, []);
});
