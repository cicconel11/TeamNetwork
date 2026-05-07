import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/20261019210000_mentor_bio_backfill_queue.sql", import.meta.url),
  "utf8"
);

test("mentor bio backfill queue is service-role only", () => {
  assert.match(
    sql,
    /grant execute on function public\.backfill_mentor_bio_queue\(uuid\) to service_role;/i
  );
  assert.match(
    sql,
    /grant execute on function public\.dequeue_mentor_bio_backfill_queue\(int\) to service_role;/i
  );
  assert.match(
    sql,
    /grant execute on function public\.increment_mentor_bio_backfill_attempts\(uuid, text\) to service_role;/i
  );
  assert.match(
    sql,
    /grant execute on function public\.purge_mentor_bio_backfill_queue\(\) to service_role;/i
  );
  assert.match(
    sql,
    /revoke execute on function public\.backfill_mentor_bio_queue\(uuid\) from authenticated;/i
  );
});

test("mentor bio backfill queue dedupes pending rows per mentor profile", () => {
  assert.match(
    sql,
    /create unique index[\s\S]*mentor_bio_backfill_queue\(organization_id, mentor_profile_id\)[\s\S]*where processed_at is null/i
  );
});

test("mentor bio backfill queue only enqueues non-manual bios", () => {
  assert.match(sql, /bio_source is distinct from 'manual'/i);
  assert.match(sql, /coalesce\(mp\.bio, ''\) = ''/i);
  assert.match(sql, /bio_input_hash/i);
});
