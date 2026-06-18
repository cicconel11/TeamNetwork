import test from "node:test";
import assert from "node:assert/strict";

import { suggestMentorsModule } from "@/lib/ai/tools/registry/suggest-mentors";

const schema = suggestMentorsModule.argsSchema;

test("coerces a single-string focus_areas into a one-element array", () => {
  const parsed = schema.parse({ focus_areas: "product management" });
  assert.deepEqual(parsed.focus_areas, ["product management"]);
});

test("coerces single strings for topics/industries/role_families", () => {
  const parsed = schema.parse({
    topics: "leadership",
    industries: "sports",
    role_families: "operations",
  });
  assert.deepEqual(parsed.topics, ["leadership"]);
  assert.deepEqual(parsed.industries, ["sports"]);
  assert.deepEqual(parsed.role_families, ["operations"]);
});

test("leaves an array of strings unchanged", () => {
  const parsed = schema.parse({ focus_areas: ["pm", "growth"] });
  assert.deepEqual(parsed.focus_areas, ["pm", "growth"]);
});

test("strips unknown keys instead of rejecting (glm tolerance)", () => {
  const parsed = schema.parse({
    focus_areas: "product",
    reasoning: "because the user asked about PM",
  }) as Record<string, unknown>;
  assert.deepEqual(parsed.focus_areas, ["product"]);
  assert.equal("reasoning" in parsed, false);
});

test("accepts a mentee_id alone", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const parsed = schema.parse({ mentee_id: id });
  assert.equal(parsed.mentee_id, id);
});

test("rejects empty args (refine: at least one criterion)", () => {
  assert.throws(() => schema.parse({}), /mentee_query, mentee_id, or mentorship criteria/);
});

test("rejects an empty-string focus_areas element", () => {
  assert.throws(() => schema.parse({ focus_areas: ["   "] }));
});
