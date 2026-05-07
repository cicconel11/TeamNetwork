import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { eventTypeSchema } from "@/lib/schemas/common";
import { EVENT_TYPE_OPTIONS } from "@/lib/events/event-type-options";

test("EVENT_TYPE_OPTIONS stays aligned with the event_type schema", () => {
  assert.deepEqual(
    EVENT_TYPE_OPTIONS.map((option) => option.value),
    eventTypeSchema.options,
  );
  assert.deepEqual(
    EVENT_TYPE_OPTIONS.map((option) => option.label),
    ["General", "Philanthropy", "Game", "Practice", "Meeting", "Social", "Workout", "Fundraiser", "Class"],
  );
});

test("class event type migration is present", () => {
  const migration = readFileSync(
    "supabase/migrations/20260404000100_add_class_event_type.sql",
    "utf8",
  );

  assert.match(migration, /alter type public\.event_type add value if not exists 'class';/i);
});
