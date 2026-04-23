// Output-side safety gate for AI assistant responses.
//
// Flow: deterministic primitives (PII / profanity / slurs) short-circuit
// to `unsafe`. Org-owned identifiers present in retrieved chunks or tool
// rows bypass PII short-circuit (not a leak — already visible to this user).
// LLM judge only fires when primitives pass and content is long enough to
// be worth classifying.
//
// Verdicts: `safe | controversial | unsafe`. Only `unsafe` blocks.

import type OpenAI from "openai";
import { createZaiClient, getZaiModel } from "@/lib/ai/client";

export type SafetyVerdict = "safe" | "controversial" | "unsafe";

export interface ClassifySafetyInput {
  content: string;
  orgContext?: {
    ownedEmails?: Iterable<string>;
    ownedPhones?: Iterable<string>;
  };
  judge?: SafetyJudge;
}

export interface SafetyResult {
  verdict: SafetyVerdict;
  categories: string[];
  latencyMs: number;
  usedJudge: boolean;
}

export type SafetyJudge = (
  prompt: string,
  content: string
) => Promise<{ verdict: SafetyVerdict; categories: string[] }>;

export const SAFETY_FALLBACK_TEXT =
  "I can't share that response. Try rephrasing or ask about your organization.";

const SAFETY_MIN_CHARS_FOR_LLM = Number.parseInt(
  process.env.SAFETY_MIN_CHARS_FOR_LLM ?? "60",
  10
);

// ---------------------------------------------------------------------------
// Deterministic primitives
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// North-American phone: 10 digits w/ optional formatting. Deliberately narrow.
const PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
// Credit card: 13–19 digits w/ optional spaces/dashes. Run Luhn to avoid
// flagging order-ids and similar long numerics.
const CC_CANDIDATE_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;

// Small illustrative slur/profanity corpus. Intentionally conservative —
// LLM judge catches context. Expand via allowlist / audit tuning.
const PROFANITY_TERMS = new Set<string>([
  // Strong slurs (placeholders — replace with real list as needed)
  "nigger",
  "faggot",
  "retard",
  "kike",
  "chink",
  "spic",
  // Generic strong profanity
  "motherfucker",
]);

function luhnValid(digits: string): boolean {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum > 0 && sum % 10 === 0;
}

export interface PIIDetection {
  emails: string[];
  phones: string[];
  ssns: string[];
  creditCards: string[];
}

export function detectPII(content: string): PIIDetection {
  const emails = [...new Set(content.match(EMAIL_PATTERN) ?? [])];
  const phones = [...new Set(content.match(PHONE_PATTERN) ?? [])];
  const ssns = [...new Set(content.match(SSN_PATTERN) ?? [])];
  const ccCandidates = content.match(CC_CANDIDATE_PATTERN) ?? [];
  const creditCards = [
    ...new Set(
      ccCandidates
        .map((c) => c.replace(/[ -]/g, ""))
        .filter((d) => d.length >= 13 && d.length <= 19 && luhnValid(d))
    ),
  ];
  return { emails, phones, ssns, creditCards };
}

export function detectProfanity(content: string): string[] {
  const tokens = content.toLowerCase().match(/\b[a-z']+\b/g) ?? [];
  const hits = new Set<string>();
  for (const tok of tokens) {
    if (PROFANITY_TERMS.has(tok)) hits.add(tok);
  }
  return [...hits];
}

// An identifier is "org-owned" if it already appears in retrieved RAG chunks
// or a tool-row-derived allowlist. Echoing such an identifier is not a leak.
export function isOrgOwnedIdentifier(
  identifier: string,
  allowlist: Iterable<string> | undefined
): boolean {
  if (!allowlist) return false;
  const normalized = identifier.trim().toLowerCase();
  for (const owned of allowlist) {
    if (owned.trim().toLowerCase() === normalized) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// LLM judge
// ---------------------------------------------------------------------------

export function buildSafetyJudgePrompt(): string {
  return [
    "You are a content safety classifier for assistant responses inside a",
    "private organizational SaaS app.",
    "",
    "Classify the ASSISTANT RESPONSE below into exactly one verdict:",
    "- `safe`: benign, on-topic, no policy concerns.",
    "- `controversial`: includes strong opinions, partisan political claims,",
    "  medical/legal advice, or edgy content that deserves logging but does",
    "  not need to be blocked.",
    "- `unsafe`: toxic, hateful, harassing, sexual content involving minors,",
    "  promotes violence, shares sensitive PII of non-members, or otherwise",
    "  violates policy.",
    "",
    "Respond ONLY with compact JSON of the form:",
    '{ "verdict": "safe" | "controversial" | "unsafe", "categories": ["..."] }',
    "No prose, no markdown.",
  ].join("\n");
}

async function defaultJudge(
  prompt: string,
  content: string
): Promise<{ verdict: SafetyVerdict; categories: string[] }> {
  const client: OpenAI = createZaiClient();
  const model = process.env.SAFETY_JUDGE_MODEL || getZaiModel();

  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: `ASSISTANT RESPONSE:\n${content}` },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content ?? "";
  return parseJudgeResponse(raw);
}

export function parseJudgeResponse(raw: string): {
  verdict: SafetyVerdict;
  categories: string[];
} {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { verdict: "safe", categories: [] };
  try {
    const parsed = JSON.parse(match[0]) as {
      verdict?: unknown;
      categories?: unknown;
    };
    const verdict: SafetyVerdict =
      parsed.verdict === "unsafe" || parsed.verdict === "controversial"
        ? parsed.verdict
        : "safe";
    const categories = Array.isArray(parsed.categories)
      ? parsed.categories.filter((v): v is string => typeof v === "string")
      : [];
    return { verdict, categories };
  } catch {
    return { verdict: "safe", categories: [] };
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function classifySafety(
  input: ClassifySafetyInput
): Promise<SafetyResult> {
  const started = Date.now();
  const { content, orgContext } = input;

  const categories: string[] = [];

  // 1. Deterministic PII scan
  const pii = detectPII(content);
  const offendingEmails = pii.emails.filter(
    (e) => !isOrgOwnedIdentifier(e, orgContext?.ownedEmails)
  );
  const offendingPhones = pii.phones.filter(
    (p) => !isOrgOwnedIdentifier(p, orgContext?.ownedPhones)
  );

  if (offendingEmails.length > 0) categories.push("pii_email");
  if (offendingPhones.length > 0) categories.push("pii_phone");
  if (pii.ssns.length > 0) categories.push("pii_ssn");
  if (pii.creditCards.length > 0) categories.push("pii_credit_card");

  const profanityHits = detectProfanity(content);
  if (profanityHits.length > 0) categories.push("profanity");

  if (categories.length > 0) {
    return {
      verdict: "unsafe",
      categories,
      latencyMs: Date.now() - started,
      usedJudge: false,
    };
  }

  // 2. LLM judge (only for long-enough content)
  if (content.trim().length <= SAFETY_MIN_CHARS_FOR_LLM) {
    return {
      verdict: "safe",
      categories: [],
      latencyMs: Date.now() - started,
      usedJudge: false,
    };
  }

  const judge = input.judge ?? defaultJudge;
  try {
    const { verdict, categories: judgeCategories } = await judge(
      buildSafetyJudgePrompt(),
      content
    );
    return {
      verdict,
      categories: judgeCategories,
      latencyMs: Date.now() - started,
      usedJudge: true,
    };
  } catch {
    // Judge failure: fail open to `safe` (primitives already caught hard
    // cases). Caller still gets latency + audit row.
    return {
      verdict: "safe",
      categories: ["judge_error"],
      latencyMs: Date.now() - started,
      usedJudge: true,
    };
  }
}
