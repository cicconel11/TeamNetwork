/**
 * Guardrail-propagation scorer. Cases force a deterministic outcome on one
 * of three production guardrails (safety / RAG / tool grounding) via
 * `input.guardrails`, then assert the handler propagated the decision into:
 *   - the final SSE text (e.g., SAFETY_FALLBACK_TEXT),
 *   - the audit row keys (e.g., safetyVerdict, ragGrounded),
 *   - and the tool-call capture (zero for pure-refusal slices).
 *
 * `expected.textIncludes` and `expected.auditIncludes` are subset-matched
 * against the captured transcript.
 */
import type { EvalCase } from "../types.ts";
import type { ScoreResult } from "./tool-use.ts";

export function scoreGuardrailPropagation(
  testCase: EvalCase,
  finalText: string,
  auditEntry: Record<string, unknown> | null
): ScoreResult {
  const { expected } = testCase;

  if (expected.textIncludes) {
    for (const needle of expected.textIncludes) {
      if (!finalText.includes(needle)) {
        return {
          passed: false,
          reason: `final text missing required substring: ${JSON.stringify(needle)}`,
        };
      }
    }
  }

  if (expected.auditIncludes) {
    if (!auditEntry) {
      return { passed: false, reason: "no audit entry captured" };
    }
    for (const [key, value] of Object.entries(expected.auditIncludes)) {
      if (auditEntry[key] !== value) {
        return {
          passed: false,
          reason: `audit.${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(auditEntry[key])}`,
        };
      }
    }
  }

  return { passed: true };
}
