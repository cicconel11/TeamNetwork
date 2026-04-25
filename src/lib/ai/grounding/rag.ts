// Freeform (no-tool-call) response grounding against retrieved RAG chunks.
//
// Flow:
//  1. Extract claims — emails, quoted titles, dates, dollar amounts,
//     declarative prose sentences.
//  2. Deterministic chunk-coverage: substring for structured claims;
//     Jaccard token overlap for prose.
//  3. LLM judge only for prose claims that failed token overlap AND have
//     entities/numbers.
//
// No retry loops. Single pass. Abstain on failure.

import type OpenAI from "openai";
import { createZaiClient, getZaiModel } from "@/lib/ai/client";
import {
  extractAllCurrencyDollars,
  extractEmails,
  extractMentionedDates,
  extractQuotedTitles,
  normalizeIdentifier,
} from "@/lib/ai/grounding/primitives";

export type RagGroundingMode = "shadow" | "overwrite" | "block" | "bypass";

export interface RagChunkForGrounding {
  contentText: string;
  sourceTable?: string;
  metadata?: Record<string, unknown>;
}

export interface RagGroundingInput {
  content: string;
  ragChunks: RagChunkForGrounding[];
  judge?: RagJudge;
  jaccardThreshold?: number;
}

export interface RagGroundingResult {
  grounded: boolean;
  uncoveredClaims: string[];
  topChunkExcerpt: string | null;
  latencyMs: number;
  usedJudge: boolean;
}

export type RagJudge = (
  chunks: string,
  claim: string
) => Promise<"yes" | "no" | "partial">;

export interface Claim {
  kind: "email" | "date" | "currency" | "quoted" | "prose";
  text: string;
}

// ---------------------------------------------------------------------------
// Claim extraction
// ---------------------------------------------------------------------------

// Prose sentence carries "factual weight" if it contains an entity or number
// (proper noun, digit, or quoted span). Otherwise not worth grounding.
function proseHasEntity(sentence: string): boolean {
  if (/\d/.test(sentence)) return true;
  if (/"[^"]+"/.test(sentence)) return true;
  // Two or more consecutive Title-Case words → likely an entity.
  if (/\b([A-Z][a-z]+)(\s+[A-Z][a-z]+)+\b/.test(sentence)) return true;
  // ALL-CAPS token ≥ 2 chars (CEO, NASA). Skip the very first token since
  // sentences start capitalized.
  const tokens = sentence.split(/\s+/).slice(1);
  if (tokens.some((t) => /^[A-Z]{2,}$/.test(t.replace(/[^A-Za-z]/g, "")))) {
    return true;
  }
  return false;
}

function splitSentences(content: string): string[] {
  return content
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function extractFreeformClaims(content: string): Claim[] {
  const claims: Claim[] = [];
  for (const email of extractEmails(content)) {
    claims.push({ kind: "email", text: email });
  }
  for (const date of extractMentionedDates(content)) {
    claims.push({ kind: "date", text: date });
  }
  for (const dollars of extractAllCurrencyDollars(content)) {
    claims.push({ kind: "currency", text: `$${dollars}` });
  }
  for (const quoted of extractQuotedTitles(content)) {
    if (quoted.trim().length > 0) {
      claims.push({ kind: "quoted", text: quoted });
    }
  }
  for (const sentence of splitSentences(content)) {
    if (proseHasEntity(sentence)) {
      claims.push({ kind: "prose", text: sentence });
    }
  }
  return claims;
}

// ---------------------------------------------------------------------------
// Chunk coverage
// ---------------------------------------------------------------------------

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export type ClaimCoverage = "covered" | "uncovered" | "prose-check";

export function claimCoveredByChunks(
  claim: Claim,
  chunks: RagChunkForGrounding[],
  jaccardThreshold: number
): ClaimCoverage {
  if (chunks.length === 0) return "uncovered";
  const combined = normalizeIdentifier(chunks.map((c) => c.contentText ?? "").join("\n"));

  if (claim.kind === "email" || claim.kind === "date") {
    return combined.includes(normalizeIdentifier(claim.text)) ? "covered" : "uncovered";
  }

  if (claim.kind === "currency") {
    // Match bare digits (strip $) in chunk text. Amount 0 is trivial — skip.
    const amount = claim.text.replace(/[^\d]/g, "");
    if (!amount || amount === "0") return "covered";
    return combined.includes(amount) ? "covered" : "uncovered";
  }

  if (claim.kind === "quoted") {
    return combined.includes(normalizeIdentifier(claim.text)) ? "covered" : "uncovered";
  }

  // prose: token overlap first, hand to judge if too thin.
  const claimTokens = tokenize(claim.text);
  let best = 0;
  for (const chunk of chunks) {
    const overlap = jaccard(claimTokens, tokenize(chunk.contentText ?? ""));
    if (overlap > best) best = overlap;
  }
  if (best >= jaccardThreshold) return "covered";
  return "prose-check";
}

// ---------------------------------------------------------------------------
// Fallback text
// ---------------------------------------------------------------------------

const FALLBACK_CHUNK_EXCERPT_LIMIT = 400;

export function buildRagGroundingFallback(
  _uncoveredClaims: string[],
  topChunk: RagChunkForGrounding | null
): string {
  const excerpt = topChunk
    ? topChunk.contentText.slice(0, FALLBACK_CHUNK_EXCERPT_LIMIT).trim()
    : "";
  if (!excerpt) {
    return "I couldn't verify that from your organization's data. Try rephrasing or ask a more specific question.";
  }
  return `I couldn't verify that from your organization's data. Here's what the source says:\n\n${excerpt}`;
}

export const RAG_GROUNDING_ABSTAIN_TEXT =
  "I don't have enough verified information to answer that from your organization's data.";

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

function buildJudgePrompt(): string {
  return [
    "You verify whether a single sentence is entailed by source chunks.",
    "Reply with exactly one word: `yes`, `no`, or `partial`.",
    "- `yes`: fully supported by the chunks.",
    "- `partial`: some terms appear but key claim is not supported.",
    "- `no`: not supported.",
  ].join("\n");
}

async function defaultJudge(
  chunks: string,
  claim: string
): Promise<"yes" | "no" | "partial"> {
  const client: OpenAI = createZaiClient();
  const model = process.env.RAG_GROUNDING_JUDGE_MODEL || getZaiModel();
  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: buildJudgePrompt() },
      {
        role: "user",
        content: `CHUNKS:\n${chunks}\n\nSENTENCE:\n${claim}`,
      },
    ],
  });
  const raw = (completion.choices?.[0]?.message?.content ?? "").toLowerCase().trim();
  if (raw.startsWith("yes")) return "yes";
  if (raw.startsWith("partial")) return "partial";
  return "no";
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function verifyRagGrounding(
  input: RagGroundingInput
): Promise<RagGroundingResult> {
  const started = Date.now();
  const { content, ragChunks } = input;
  const jaccardThreshold =
    input.jaccardThreshold ??
    Number.parseFloat(process.env.RAG_GROUNDING_JACCARD_THRESHOLD ?? "0.35");

  if (!ragChunks || ragChunks.length === 0) {
    return {
      grounded: true,
      uncoveredClaims: [],
      topChunkExcerpt: null,
      latencyMs: Date.now() - started,
      usedJudge: false,
    };
  }

  const claims = extractFreeformClaims(content);
  if (claims.length === 0) {
    return {
      grounded: true,
      uncoveredClaims: [],
      topChunkExcerpt: null,
      latencyMs: Date.now() - started,
      usedJudge: false,
    };
  }

  const uncovered: string[] = [];
  const proseToJudge: string[] = [];

  for (const claim of claims) {
    const coverage = claimCoveredByChunks(claim, ragChunks, jaccardThreshold);
    if (coverage === "covered") continue;
    if (coverage === "uncovered") {
      uncovered.push(claim.text);
      continue;
    }
    if (coverage === "prose-check") {
      proseToJudge.push(claim.text);
    }
  }

  let usedJudge = false;
  if (proseToJudge.length > 0) {
    const judge = input.judge ?? defaultJudge;
    const combined = ragChunks
      .map((c) => c.contentText ?? "")
      .join("\n---\n")
      .slice(0, 4000);
    for (const sentence of proseToJudge) {
      try {
        usedJudge = true;
        const verdict = await judge(combined, sentence);
        if (verdict === "no") uncovered.push(sentence);
      } catch {
        // judge failure: conservatively mark uncovered
        uncovered.push(sentence);
      }
    }
  }

  const topChunk = ragChunks[0] ?? null;
  const topChunkExcerpt = topChunk
    ? topChunk.contentText.slice(0, FALLBACK_CHUNK_EXCERPT_LIMIT)
    : null;

  return {
    grounded: uncovered.length === 0,
    uncoveredClaims: uncovered.slice(0, 20),
    topChunkExcerpt,
    latencyMs: Date.now() - started,
    usedJudge,
  };
}
