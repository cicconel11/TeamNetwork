import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PASS2_ANSWER_NARROWNESS_INSTRUCTION } from "../src/app/api/ai/[orgId]/chat/handler/stages/run-model-tools-loop.ts";

describe("PASS2_ANSWER_NARROWNESS_INSTRUCTION", () => {
  it("calls out single-number scope discipline", () => {
    assert.match(PASS2_ANSWER_NARROWNESS_INSTRUCTION, /single number/i);
    assert.match(PASS2_ANSWER_NARROWNESS_INSTRUCTION, /how many active members/i);
  });

  it("calls out single-dimension scope discipline", () => {
    assert.match(PASS2_ANSWER_NARROWNESS_INSTRUCTION, /single dimension/i);
    assert.match(PASS2_ANSWER_NARROWNESS_INSTRUCTION, /donation trends/i);
  });

  it("forbids leading with totals when user asked for trend", () => {
    assert.match(
      PASS2_ANSWER_NARROWNESS_INSTRUCTION,
      /do not lead with totals/i
    );
  });

  it("forbids enumerating other categories", () => {
    assert.match(PASS2_ANSWER_NARROWNESS_INSTRUCTION, /do not enumerate/i);
  });

  it("permits full picture when user explicitly asks for it", () => {
    assert.match(
      PASS2_ANSWER_NARROWNESS_INSTRUCTION,
      /explicitly asked for the full picture/i
    );
  });
});
