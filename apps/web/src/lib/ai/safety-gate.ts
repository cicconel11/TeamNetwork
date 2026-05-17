// Output-side safety gate for AI assistant responses.
//
// Flow: deterministic primitives (PII / profanity / slurs) short-circuit
// to `unsafe`. Org-owned identifiers present in retrieved chunks or tool
// rows bypass PII short-circuit (not a leak — already visible to this user).
// LLM judge only fires when primitives pass and content is long enough to
// be worth classifying.
//
// Verdicts: `safe | controversial | unsafe`. Only `unsafe` blocks.

import { AiCapReachedError, chargeAiSpend, checkAiSpend } from "@/lib/ai/spend";
import { Profiles, runLlmCompletion } from "@/lib/ai/llm";

export type SafetyVerdict = "safe" | "controversial" | "unsafe";

export type SafetyFailMode = "block" | "controversial" | "open";

export type SafetyTrackOpsEventFn = (
  event: "api_error",
  props: {
    endpoint_group: string;
    error_code: string;
    http_status?: number;
    retryable?: boolean;
  },
  orgId?: string | null
) => void | Promise<void>;

export interface ClassifySafetyInput {
  content: string;
  orgContext?: {
    ownedEmails?: Iterable<string>;
    ownedPhones?: Iterable<string>;
  };
  /** Org used for spend accounting on the judge LLM call. */
  orgId?: string;
  /** Skip ledger write (dev-admin bypass). */
  spendBypass?: boolean;
  judge?: SafetyJudge;
  /** Optional fail-mode override (default resolves from env). */
  failMode?: SafetyFailMode;
  /** Optional ops telemetry sink (fire-and-forget). */
  trackOpsEvent?: SafetyTrackOpsEventFn;
}

export interface SafetyResult {
  verdict: SafetyVerdict;
  categories: string[];
  latencyMs: number;
  usedJudge: boolean;
}

export type JudgeOutcome =
  | { kind: "ok"; verdict: SafetyVerdict; categories: string[] }
  | { kind: "parse_failed"; raw: string }
  | { kind: "cap_reached" };

export type SafetyJudge = (
  prompt: string,
  content: string
) => Promise<JudgeOutcome | { verdict: SafetyVerdict; categories: string[] }>;

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

function normalizeIdentifier(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("@")) {
    return normalized;
  }
  const digits = normalized.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  if (digits.length === 10) {
    return digits;
  }
  return normalized;
}

// An identifier is "org-owned" if it already appears in retrieved RAG chunks
// or a tool-row-derived allowlist. Echoing such an identifier is not a leak.
export function isOrgOwnedIdentifier(
  identifier: string,
  allowlist: Iterable<string> | undefined
): boolean {
  if (!allowlist) return false;
  const normalized = normalizeIdentifier(identifier);
  for (const owned of allowlist) {
    if (normalizeIdentifier(owned) === normalized) return true;
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
  content: string,
  orgId?: string,
  spendBypass?: boolean
): Promise<JudgeOutcome> {
  if (orgId) {
    try {
      await checkAiSpend(orgId, { bypass: spendBypass });
    } catch (err) {
      if (err instanceof AiCapReachedError) {
        return { kind: "cap_reached" };
      }
      throw err;
    }
  }

  const profile = Profiles.safetyJudge();
  const { completion, actualModel } = await runLlmCompletion(profile, {
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: `ASSISTANT RESPONSE:\n${content}` },
    ],
    orgId,
  });

  if (orgId && completion.usage) {
    await chargeAiSpend({
      orgId,
      model: actualModel,
      inputTokens: completion.usage.prompt_tokens ?? 0,
      outputTokens: completion.usage.completion_tokens ?? 0,
      bypass: spendBypass,
    });
  }

  const raw = completion.choices?.[0]?.message?.content ?? "";
  const parsed = parseJudgeResponse(raw);
  if (!parsed.parseOk) {
    return { kind: "parse_failed", raw };
  }
  return { kind: "ok", verdict: parsed.verdict, categories: parsed.categories };
}

function resolveFailMode(explicit?: SafetyFailMode): SafetyFailMode {
  if (explicit) return explicit;
  if (process.env.SAFETY_JUDGE_FAIL_OPEN === "1") return "open";
  const env = process.env.SAFETY_JUDGE_FAIL_MODE;
  if (env === "open" || env === "block" || env === "controversial") return env;
  return "controversial";
}

function fallbackVerdictForFailMode(mode: SafetyFailMode): SafetyVerdict {
  switch (mode) {
    case "open":
      return "safe";
    case "block":
      return "unsafe";
    case "controversial":
    default:
      return "controversial";
  }
}

function emitOpsEvent(
  trackOpsEvent: SafetyTrackOpsEventFn | undefined,
  errorCode: string,
  orgId: string | undefined
): void {
  if (!trackOpsEvent) return;
  try {
    void Promise.resolve(
      trackOpsEvent(
        "api_error",
        { endpoint_group: "ai_safety_judge", error_code: errorCode, retryable: false },
        orgId ?? null
      )
    ).catch(() => {});
  } catch {
    // swallow
  }
}

export interface ParsedJudgeResponse {
  verdict: SafetyVerdict;
  categories: string[];
  parseOk: boolean;
}

export function parseJudgeResponse(raw: string): ParsedJudgeResponse {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { verdict: "safe", categories: [], parseOk: false };
  try {
    const parsed = JSON.parse(match[0]) as {
      verdict?: unknown;
      categories?: unknown;
    };
    const verdictOk =
      parsed.verdict === "safe" ||
      parsed.verdict === "controversial" ||
      parsed.verdict === "unsafe";
    if (!verdictOk) {
      return { verdict: "safe", categories: [], parseOk: false };
    }
    const verdict = parsed.verdict as SafetyVerdict;
    const categories = Array.isArray(parsed.categories)
      ? parsed.categories.filter((v): v is string => typeof v === "string")
      : [];
    return { verdict, categories, parseOk: true };
  } catch {
    return { verdict: "safe", categories: [], parseOk: false };
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

  const failMode = resolveFailMode(input.failMode);
  const fallback = fallbackVerdictForFailMode(failMode);

  const judge =
    input.judge ?? ((p, c) => defaultJudge(p, c, input.orgId, input.spendBypass));

  let outcome: JudgeOutcome;
  try {
    const raw = await judge(buildSafetyJudgePrompt(), content);
    outcome = normalizeJudgeOutcome(raw);
  } catch {
    emitOpsEvent(input.trackOpsEvent, "safety_judge_throw", input.orgId);
    return {
      verdict: fallback,
      categories: ["judge_error", `fail_mode:${failMode}`],
      latencyMs: Date.now() - started,
      usedJudge: true,
    };
  }

  if (outcome.kind === "cap_reached") {
    emitOpsEvent(input.trackOpsEvent, "safety_judge_cap_reached", input.orgId);
    return {
      verdict: "safe",
      categories: ["judge_cap_reached"],
      latencyMs: Date.now() - started,
      usedJudge: true,
    };
  }

  if (outcome.kind === "parse_failed") {
    emitOpsEvent(input.trackOpsEvent, "safety_judge_parse_failed", input.orgId);
    return {
      verdict: fallback,
      categories: ["judge_parse_failed", `fail_mode:${failMode}`],
      latencyMs: Date.now() - started,
      usedJudge: true,
    };
  }

  return {
    verdict: outcome.verdict,
    categories: outcome.categories,
    latencyMs: Date.now() - started,
    usedJudge: true,
  };
}

function normalizeJudgeOutcome(
  raw: JudgeOutcome | { verdict: SafetyVerdict; categories: string[] }
): JudgeOutcome {
  if ("kind" in raw) return raw;
  return { kind: "ok", verdict: raw.verdict, categories: raw.categories };
}
