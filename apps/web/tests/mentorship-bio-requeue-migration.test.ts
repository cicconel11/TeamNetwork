import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL(
    "../supabase/migrations/20261218000000_mentor_bio_requeue_triggers.sql",
    import.meta.url
  ),
  "utf8"
);

test("all requeue trigger functions are SECURITY DEFINER with empty search_path", () => {
  // Three CREATE OR REPLACE FUNCTION ... RETURNS trigger definitions.
  const functions = sql.match(/create or replace function[\s\S]*?\$\$;/gi) ?? [];
  assert.equal(functions.length, 3, "expected exactly three trigger functions");

  for (const fn of functions) {
    assert.match(fn, /returns trigger/i);
    assert.match(fn, /security definer/i);
    assert.match(fn, /set search_path = ''/i);
    assert.match(fn, /language plpgsql/i);
  }
});

test("manual bios are never re-enqueued", () => {
  // Profile trigger guards NEW.bio_source; alumni/member triggers guard the join.
  assert.match(sql, /bio_source is not distinct from 'manual'/i);
  assert.match(sql, /bio_source is distinct from 'manual'/i);
});

test("enqueue inserts dedupe via ON CONFLICT DO NOTHING", () => {
  const inserts =
    sql.match(/insert into public\.mentor_bio_backfill_queue/gi) ?? [];
  assert.equal(inserts.length, 3, "expected three enqueue inserts");
  // Each enqueue statement (INSERT ... VALUES / INSERT ... SELECT) must dedupe.
  const conflictGuards = sql.match(/on conflict do nothing/gi) ?? [];
  assert.ok(
    conflictGuards.length >= 3,
    "every enqueue insert must use ON CONFLICT DO NOTHING"
  );
});

test("alumni/member triggers skip unlinked rows via NEW.user_id IS NOT NULL", () => {
  // Guard is expressed as an early RETURN when NEW.user_id IS NULL.
  assert.match(sql, /new\.user_id is null/i);
});

test("mentor_profiles trigger ignores bio writeback columns to avoid loops", () => {
  // Relevant columns are guarded with IS NOT DISTINCT FROM; bio columns are not.
  for (const col of [
    "expertise_areas",
    "topics",
    "sports",
    "positions",
    "industries",
    "role_families",
    "custom_attributes",
  ]) {
    assert.match(
      sql,
      new RegExp(`new\\.${col} is not distinct from old\\.${col}`, "i"),
      `expected diff guard on mentor_profiles.${col}`
    );
  }
});

test("triggers are registered on mentor_profiles, alumni, and members", () => {
  assert.match(
    sql,
    /create trigger trg_mentor_bio_requeue_mentor_profiles\s+after insert or update on public\.mentor_profiles/i
  );
  assert.match(
    sql,
    /create trigger trg_mentor_bio_requeue_alumni\s+after insert or update on public\.alumni/i
  );
  assert.match(
    sql,
    /create trigger trg_mentor_bio_requeue_members\s+after insert or update on public\.members/i
  );
});

test("trigger registration is idempotent via drop-first", () => {
  const drops = sql.match(/drop trigger if exists trg_mentor_bio_requeue_/gi) ?? [];
  assert.equal(drops.length, 3, "each trigger should be dropped before re-create");
});

test("vercel.json schedules the mentor-bio-process queue drain cron", async () => {
  const raw = await readFile(new URL("../vercel.json", import.meta.url), "utf8");
  const config = JSON.parse(raw) as {
    crons?: Array<{ path: string; schedule: string }>;
  };
  const entry = config.crons?.find(
    (c) => c.path === "/api/cron/mentor-bio-process"
  );
  assert.ok(entry, "vercel.json crons must include /api/cron/mentor-bio-process");
  assert.match(entry!.schedule, /^[\d*/, -]+$/, "schedule must be a cron expression");
});
