import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  generateMatchWhyBatch,
  generateMatchWhy,
} from "@/lib/mentorship/why-generator";
import type { MentorshipSignal } from "@/lib/mentorship/matching";

const realSignals: MentorshipSignal[] = [
  { code: "career_trajectory", weight: 30, value: "Finance" },
  { code: "shared_school", weight: 14, value: "Cornell" },
];

describe("generateMatchWhyBatch", () => {
  it("returns deterministic prose for fallback-only candidates without calling the LLM", async () => {
    const results = await generateMatchWhyBatch({
      menteeName: "Jordan Lee",
      candidates: [
        {
          id: "m1",
          mentorName: "Pat",
          signals: [{ code: "fallback_general", weight: 1, value: "limited mentee data" }],
        },
      ],
      orgId: "org-1",
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].model, "template");
    assert.match(results[0].why, /Suggested while we learn more/);
  });

  it("falls back to the deterministic template when the LLM is unavailable", async () => {
    const results = await generateMatchWhyBatch({
      menteeName: "Jordan Lee",
      candidates: [{ id: "m1", mentorName: "Pat", signals: realSignals }],
      orgId: "org-1",
    });
    assert.equal(results[0].model, "template");
    assert.match(results[0].why, /Has worked in Finance/);
    assert.match(results[0].why, /Same school: Cornell/);
  });

  it("yields an empty why for a candidate with no signals", async () => {
    const results = await generateMatchWhyBatch({
      menteeName: "Jordan",
      candidates: [{ id: "m1", mentorName: "Pat", signals: [] }],
      orgId: "org-1",
    });
    assert.equal(results[0].why, "");
  });
});

describe("generateMatchWhy (single)", () => {
  it("wraps the batch path for one candidate", async () => {
    const { why, model } = await generateMatchWhy({
      menteeName: "Jordan",
      mentorName: "Pat",
      signals: realSignals,
      orgId: "org-1",
    });
    assert.equal(model, "template");
    assert.match(why, /Has worked in Finance/);
  });
});
