/**
 * Bridge: real thumbs-down `ai_feedback` → proposed golden-set rows for the AI-eval loop.
 *
 * This is the DISCOVERY plumbing for the loop's highest-value source. `feedback-evals.ts` turns a
 * negative-rated assistant turn into an `AiFeedbackEvalCandidate` carrying the user's actual prompt and
 * the surface they were on. This module runs that prompt through the *current* deterministic router
 * (`resolveSurfaceRouting`) and reports what it produces, so a human reviewing the miss can confirm or
 * correct the expected routing and promote it into the golden set.
 *
 * It deliberately does NOT decide the correct answer itself — a thumbs-down means a human judged the
 * turn wrong, and only a human sets the `expect*` values. This module surfaces candidates and the
 * classifier's current behavior; the human supplies ground truth. That keeps the loop from grading its
 * own homework (the generator/evaluator split applied to discovery).
 */

import type { AiSurface } from "@/lib/schemas/ai-assistant";
import type { AiFeedbackEvalCandidate } from "@/lib/ai/feedback-evals";
import {
  resolveSurfaceRouting,
  type AiIntent,
} from "@/lib/ai/intent-router";

const SURFACES: readonly AiSurface[] = ["general", "members", "analytics", "events"];

function coerceSurface(value: string): AiSurface {
  return (SURFACES as readonly string[]).includes(value)
    ? (value as AiSurface)
    : "general";
}

export interface GoldenRowProposal {
  /** The real user prompt from the thumbs-down turn. */
  input: string;
  /** Surface the user was on (coerced to a valid AiSurface; unknowns → general). */
  surface: AiSurface;
  /** What the current router produces for this prompt — the suspected-wrong behavior. */
  current: {
    intent: AiIntent;
    effectiveSurface: AiSurface;
  };
  /** Source feedback id, so a promoted row is traceable back to the real miss. */
  feedbackId: string;
  /** The user's free-text complaint, if any — context for the human setting ground truth. */
  comment: string | null;
  /**
   * True when the candidate lacks the data to be a clean routing row (no prompt, etc.).
   * Incomplete proposals go to the inbox for a human, never auto-promoted.
   */
  incomplete: boolean;
}

/**
 * Convert one feedback candidate into a golden-row proposal. Returns null only when there is no prompt
 * at all to route (nothing to score). The caller (the ai-eval-loop skill) presents non-null proposals
 * to a human, who decides the correct expectIntent/expectSurface and promotes — or discards — the row.
 */
export function feedbackCandidateToGoldenProposal(
  candidate: AiFeedbackEvalCandidate
): GoldenRowProposal | null {
  const input = candidate.prompt.trim();
  if (input.length === 0) return null;

  const surface = coerceSurface(candidate.surface);
  const decision = resolveSurfaceRouting(input, surface);

  return {
    input,
    surface,
    current: {
      intent: decision.intent,
      effectiveSurface: decision.effectiveSurface,
    },
    feedbackId: candidate.sourceIds.feedbackId,
    comment: candidate.feedback.comment,
    incomplete: candidate.incomplete,
  };
}

export function feedbackCandidatesToGoldenProposals(
  candidates: readonly AiFeedbackEvalCandidate[]
): GoldenRowProposal[] {
  return candidates
    .map((c) => feedbackCandidateToGoldenProposal(c))
    .filter((p): p is GoldenRowProposal => p != null);
}
