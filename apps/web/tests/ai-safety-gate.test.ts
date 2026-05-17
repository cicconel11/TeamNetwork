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
import { collectPhoneNumberFields } from "../src/app/api/ai/[orgId]/chat/handler.ts";

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

test("isOrgOwnedIdentifier normalizes phone formatting", () => {
  assert.equal(
    isOrgOwnedIdentifier("415-555-2671", ["(415) 555-2671"]),
    true
  );
  assert.equal(
    isOrgOwnedIdentifier("+1 415 555 2671", ["4155552671"]),
    true
  );
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

test("classifySafety passes when phone is org-owned across formatting variants", async () => {
  const result = await classifySafety({
    content: "Call me at 415-555-2671",
    orgContext: { ownedPhones: ["(415) 555-2671"] },
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

test("classifySafety fails closed to controversial on judge error and fires ops event", async () => {
  const long = "This is a longer benign message. ".repeat(5);
  const ops: Array<[string, Record<string, unknown>, string | null | undefined]> = [];
  const result = await classifySafety({
    content: long,
    judge: async () => {
      throw new Error("network down");
    },
    trackOpsEvent: (event, props, orgId) => {
      ops.push([event, props, orgId ?? null]);
    },
  });
  assert.equal(result.verdict, "controversial");
  assert.ok(result.categories.includes("judge_error"));
  assert.ok(result.categories.includes("fail_mode:controversial"));
  assert.equal(ops.length, 1);
  assert.equal(ops[0][0], "api_error");
  assert.equal(ops[0][1].error_code, "safety_judge_throw");
});

test("classifySafety failMode=open restores legacy safe verdict and still fires ops event", async () => {
  const long = "This is a longer benign message. ".repeat(5);
  const ops: Array<[string, Record<string, unknown>, string | null | undefined]> = [];
  const result = await classifySafety({
    content: long,
    failMode: "open",
    judge: async () => {
      throw new Error("network down");
    },
    trackOpsEvent: (event, props, orgId) => {
      ops.push([event, props, orgId ?? null]);
    },
  });
  assert.equal(result.verdict, "safe");
  assert.ok(result.categories.includes("fail_mode:open"));
  assert.equal(ops[0][1].error_code, "safety_judge_throw");
});

test("classifySafety fails closed on judge parse failure and fires ops event", async () => {
  const long = "This is a longer benign message. ".repeat(5);
  const ops: Array<[string, Record<string, unknown>, string | null | undefined]> = [];
  const result = await classifySafety({
    content: long,
    judge: async () => ({ kind: "parse_failed", raw: "junk" }),
    trackOpsEvent: (event, props, orgId) => {
      ops.push([event, props, orgId ?? null]);
    },
  });
  assert.equal(result.verdict, "controversial");
  assert.ok(result.categories.includes("judge_parse_failed"));
  assert.equal(ops[0][1].error_code, "safety_judge_parse_failed");
});

test("classifySafety spend cap returns safe with telemetry", async () => {
  const long = "This is a longer benign message. ".repeat(5);
  const ops: Array<[string, Record<string, unknown>, string | null | undefined]> = [];
  const result = await classifySafety({
    content: long,
    judge: async () => ({ kind: "cap_reached" }),
    trackOpsEvent: (event, props, orgId) => {
      ops.push([event, props, orgId ?? null]);
    },
  });
  assert.equal(result.verdict, "safe");
  assert.deepEqual(result.categories, ["judge_cap_reached"]);
  assert.equal(ops[0][1].error_code, "safety_judge_cap_reached");
});

test("parseJudgeResponse tolerates prose wrappers", () => {
  const r = parseJudgeResponse(
    'Here is my classification: {"verdict": "unsafe", "categories": ["toxicity"]} done.'
  );
  assert.equal(r.verdict, "unsafe");
  assert.deepEqual(r.categories, ["toxicity"]);
  assert.equal(r.parseOk, true);
});

test("parseJudgeResponse returns parseOk=false on malformed JSON", () => {
  const r = parseJudgeResponse("no json here");
  assert.equal(r.verdict, "safe");
  assert.deepEqual(r.categories, []);
  assert.equal(r.parseOk, false);
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

test("collectPhoneNumberFields harvests phone_number from structured rows", () => {
  const owned = new Set<string>();
  collectPhoneNumberFields(
    [
      {
        name: "list_parents",
        data: {
          rows: [
            { full_name: "Alice", phone_number: "415-555-2671" },
            { full_name: "Bob", phone_number: "415-555-0099" },
          ],
        },
      },
    ],
    owned
  );
  assert.ok(owned.has("415-555-2671"));
  assert.ok(owned.has("415-555-0099"));
});

test("collectPhoneNumberFields ignores phones embedded in free-text description fields", () => {
  const owned = new Set<string>();
  collectPhoneNumberFields(
    [
      {
        name: "list_announcements",
        data: {
          rows: [
            {
              title: "Reminder",
              description: "Call coach at 415-555-1111 anytime",
            },
          ],
        },
      },
    ],
    owned
  );
  assert.equal(owned.size, 0, "free-text description must NOT widen the phone allowlist");
});

test("collectPhoneNumberFields ignores non-string phone_number values", () => {
  const owned = new Set<string>();
  collectPhoneNumberFields({ phone_number: 4155550000 }, owned);
  assert.equal(owned.size, 0);
});
