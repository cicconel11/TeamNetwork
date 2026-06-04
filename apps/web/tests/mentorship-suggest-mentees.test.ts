import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { suggestMenteesModule } from "@/lib/ai/tools/registry/suggest-mentees";
import { formatSuggestMenteesResponse } from "@/app/api/ai/[orgId]/chat/handler/formatters/reads";

describe("suggest_mentees tool schema", () => {
  it("requires mentor_id or mentor_query", () => {
    assert.equal(suggestMenteesModule.name, "suggest_mentees");
    assert.equal(suggestMenteesModule.argsSchema.safeParse({}).success, false);
    assert.equal(
      suggestMenteesModule.argsSchema.safeParse({ mentor_query: "Pat" }).success,
      true
    );
    assert.equal(
      suggestMenteesModule.argsSchema.safeParse({
        mentor_id: "00000000-0000-0000-0000-000000000000",
      }).success,
      true
    );
    // limit is bounded
    assert.equal(
      suggestMenteesModule.argsSchema.safeParse({ mentor_query: "Pat", limit: 99 }).success,
      false
    );
  });
});

describe("formatSuggestMenteesResponse", () => {
  it("renders resolved mentee suggestions with reasons", () => {
    const out = formatSuggestMenteesResponse({
      state: "resolved",
      mentor: { name: "Alex Rivera" },
      suggestions: [
        {
          mentee: { user_id: "u1", name: "Jordan Lee", subtitle: null },
          score: 30,
          reasons: [{ code: "shared_industry", label: "Same industry", value: "Finance" }],
        },
      ],
    });
    assert.ok(out);
    assert.match(out!, /Top mentees for Alex Rivera/);
    assert.match(out!, /Jordan Lee/);
    assert.match(out!, /Same industry: Finance/);
  });

  it("handles the no-suggestions and unauthorized states", () => {
    assert.match(
      formatSuggestMenteesResponse({ state: "no_suggestions", mentor: { name: "Alex" } })!,
      /no students seeking mentorship/
    );
    assert.match(
      formatSuggestMenteesResponse({ state: "unauthorized" })!,
      /admins only/
    );
  });
});
