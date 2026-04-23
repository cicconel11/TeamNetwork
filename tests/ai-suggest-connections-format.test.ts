/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CONNECTION_PASS2_TEMPLATE,
  formatSuggestConnectionsResponse,
} from "../src/app/api/ai/[orgId]/chat/handler.ts";

describe("formatSuggestConnectionsResponse", () => {
  it("embeds [ref: person_type:person_id] tags on ambiguous options", () => {
    const output = formatSuggestConnectionsResponse({
      state: "ambiguous",
      disambiguation_options: [
        {
          person_type: "member",
          person_id: "uuid-1",
          name: "Louis Ciccone",
          subtitle: "Chairman and CEO • Microsoft",
        },
        {
          person_type: "alumni",
          person_id: "uuid-2",
          name: "Louis Ciccone",
          subtitle: "Analyst • Example Co",
        },
      ],
    });
    assert.ok(output, "expected a rendered response");
    assert.match(output!, /Louis Ciccone - Chairman and CEO • Microsoft \[ref: member:uuid-1\]/);
    assert.match(output!, /Louis Ciccone - Analyst • Example Co \[ref: alumni:uuid-2\]/);
  });

  it("omits the [ref: …] tail when ids are missing", () => {
    const output = formatSuggestConnectionsResponse({
      state: "ambiguous",
      disambiguation_options: [{ name: "Louis Ciccone", subtitle: "Analyst" }],
    });
    assert.ok(output);
    assert.doesNotMatch(output!, /\[ref:/);
  });

  it("ignores unexpected person_type values", () => {
    const output = formatSuggestConnectionsResponse({
      state: "ambiguous",
      disambiguation_options: [
        {
          person_type: "imposter",
          person_id: "uuid-1",
          name: "Louis Ciccone",
          subtitle: "Analyst",
        },
      ],
    });
    assert.ok(output);
    assert.doesNotMatch(output!, /\[ref:/);
  });
});

describe("CONNECTION_PASS2_TEMPLATE", () => {
  it("instructs the model to re-call with person_type / person_id from the ref tag", () => {
    assert.match(CONNECTION_PASS2_TEMPLATE, /\[ref: person_type:person_id\]/);
    assert.match(CONNECTION_PASS2_TEMPLATE, /person_type and person_id/);
    assert.match(CONNECTION_PASS2_TEMPLATE, /not person_query/);
  });
});
