import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { suggestMentorsModule } from "@/lib/ai/tools/registry/suggest-mentors";

describe("suggest_mentors tool schema", () => {
  it("accepts either a person or criteria", () => {
    const schema = suggestMentorsModule.argsSchema;

    assert.equal(schema.safeParse({}).success, false);
    assert.equal(schema.safeParse({ mentee_query: "Jane" }).success, true);
    assert.equal(schema.safeParse({ topics: ["marketing"] }).success, true);
    assert.equal(schema.safeParse({ industries: ["Law"] }).success, true);
    assert.equal(schema.safeParse({ role_families: ["Legal"] }).success, true);
    assert.equal(schema.safeParse({ goals: "break into product" }).success, true);
    assert.equal(schema.safeParse({ topics: ["marketing"], limit: 99 }).success, false);
  });
});
