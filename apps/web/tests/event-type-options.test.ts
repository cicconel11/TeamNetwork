import test from "node:test";
import assert from "node:assert/strict";
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
