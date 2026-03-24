import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAiMessage,
  normalizeAiMessageForExactMatch,
} from "../src/lib/ai/message-normalization.ts";
import { normalizePrompt } from "../src/lib/ai/semantic-cache-utils.ts";
import { normalizeMessage } from "../src/lib/ai/intent-router.ts";

test("shared normalization matches router and cache callers", () => {
  const input = "  He\u200By THERE!!\n";
  const normalized = normalizeAiMessage(input);

  assert.equal(normalized, "hey there!!");
  assert.equal(normalizePrompt(input), normalized);
  assert.equal(normalizeMessage(input), normalized);
});

test("exact-match normalization strips punctuation for casual matching", () => {
  assert.equal(normalizeAiMessageForExactMatch("Thanks!!"), "thanks");
  assert.equal(normalizeAiMessageForExactMatch("Hi, team!"), "hi team");
});
