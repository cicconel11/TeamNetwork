import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BEHAVIORAL_EVENT_NAMES } from "@/lib/analytics/events";

describe("search behavioral analytics (client contract)", () => {
  it("includes search event names", () => {
    assert.ok(BEHAVIORAL_EVENT_NAMES.includes("search_used"));
    assert.ok(BEHAVIORAL_EVENT_NAMES.includes("search_result_click"));
  });

  it("search click payload keys must stay redacted (no raw content identifiers)", () => {
    const clickKeys = ["query_length", "mode", "clicked_entity_type", "result_position", "referrer_type", "consent_state"];
    const forbiddenExact = new Set([
      "query",
      "title",
      "name",
      "email",
      "entity_id",
      "thread_id",
      "event_id",
      "job_id",
    ]);
    for (const k of clickKeys) {
      assert.ok(!forbiddenExact.has(k), `unexpected key ${k}`);
    }
  });
});
