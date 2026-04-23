import test from "node:test";
import assert from "node:assert/strict";
import {
  classifySafety,
  detectPII,
  detectProfanity,
  isOrgOwnedIdentifier,
  parseJudgeResponse,
  buildSafetyJudgePrompt,
  SAFETY_FALLBACK_TEXT,
} from "../src/lib/ai/safety-gate.ts";

test("detectPII finds emails, phones, SSNs, credit cards (Luhn)", () => {
  const result = detectPII(
    "Contact me at alice@example.com or 415-555-2671. SSN 123-45-6789. Card 4111 1111 1111 1111."
  );
  assert.ok(result.emails.includes("alice@example.com"));
  assert.ok(result.phones.length > 0);
  assert.deepEqual(result.ssns, ["123-45-6789"]);
  assert.ok(result.creditCards.length === 1);
});

test("detectPII rejects non-Luhn 16-digit numbers as credit cards", () => {
  const result = detectPII("order number 1234567890123456 not a card");
  assert.equal(result.creditCards.length, 0);
});

test("detectProfanity matches whole tokens only", () => {
  const hits = detectProfanity("Some retard said a motherfucker thing.");
  assert.ok(hits.includes("retard"));
  assert.ok(hits.includes("motherfucker"));
});

test("detectProfanity skips substrings", () => {
  const hits = detectProfanity("this is classification");
  assert.deepEqual(hits, []);
});

test("isOrgOwnedIdentifier matches case-insensitive", () => {
  assert.equal(
    isOrgOwnedIdentifier("Alice@Example.com", ["alice@example.com"]),
    true
  );
  assert.equal(isOrgOwnedIdentifier("bob@example.com", ["alice@example.com"]), false);
  assert.equal(isOrgOwnedIdentifier("x", undefined), false);
});

test("classifySafety short-circuits on PII with no allowlist", async () => {
  const result = await classifySafety({
    content: "Reach me at stranger@example.com",
    judge: async () => ({ verdict: "safe", categories: [] }),
  });
  assert.equal(result.verdict, "unsafe");
  assert.ok(result.categories.includes("pii_email"));
  assert.equal(result.usedJudge, false);
});

test("classifySafety passes when email is org-owned", async () => {
  const result = await classifySafety({
    content: "Reach me at alice@example.com",
    orgContext: { ownedEmails: ["alice@example.com"] },
    judge: async () => ({ verdict: "safe", categories: [] }),
  });
  assert.equal(result.verdict, "safe");
});

test("classifySafety blocks on profanity", async () => {
  const result = await classifySafety({
    content: "you are a retard",
    judge: async () => ({ verdict: "safe", categories: [] }),
  });
  assert.equal(result.verdict, "unsafe");
  assert.ok(result.categories.includes("profanity"));
});

test("classifySafety skips LLM judge for short benign content", async () => {
  let judgeCalled = false;
  const result = await classifySafety({
    content: "Hi.",
    judge: async () => {
      judgeCalled = true;
      return { verdict: "safe", categories: [] };
    },
  });
  assert.equal(result.verdict, "safe");
  assert.equal(judgeCalled, false);
});

test("classifySafety delegates long content to judge", async () => {
  const long = "This is a longer benign message. ".repeat(5);
  const result = await classifySafety({
    content: long,
    judge: async () => ({ verdict: "controversial", categories: ["politics"] }),
  });
  assert.equal(result.verdict, "controversial");
  assert.deepEqual(result.categories, ["politics"]);
  assert.equal(result.usedJudge, true);
});

test("classifySafety fails open on judge error", async () => {
  const long = "This is a longer benign message. ".repeat(5);
  const result = await classifySafety({
    content: long,
    judge: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(result.verdict, "safe");
  assert.ok(result.categories.includes("judge_error"));
});

test("parseJudgeResponse tolerates prose wrappers", () => {
  const r = parseJudgeResponse(
    'Here is my classification: {"verdict": "unsafe", "categories": ["toxicity"]} done.'
  );
  assert.equal(r.verdict, "unsafe");
  assert.deepEqual(r.categories, ["toxicity"]);
});

test("parseJudgeResponse defaults to safe on malformed JSON", () => {
  assert.deepEqual(parseJudgeResponse("no json here"), {
    verdict: "safe",
    categories: [],
  });
});

test("SAFETY_FALLBACK_TEXT is non-empty", () => {
  assert.ok(SAFETY_FALLBACK_TEXT.length > 0);
});

test("buildSafetyJudgePrompt defines tri-class schema", () => {
  const prompt = buildSafetyJudgePrompt();
  assert.match(prompt, /safe/);
  assert.match(prompt, /controversial/);
  assert.match(prompt, /unsafe/);
});
