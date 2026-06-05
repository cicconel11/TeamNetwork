import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isStageTimeoutError } from "@/lib/ai/timeout";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import {
  createOrRevisePendingAction,
  type CreateMentorshipPairingPendingPayload,
} from "@/lib/ai/pending-actions";
import {
  buildPendingActionField,
  pendingActionFailureToToolError,
} from "@/lib/ai/tools/prepare-tool-helpers";
import { buildDeterministicWhy } from "@/lib/mentorship/presentation";
import type { ToolModule } from "./types";

const prepareMentorshipPairingSchema = z
  .object({
    mentee_id: z.string().uuid().optional(),
    mentee_query: z.string().trim().min(1).optional(),
    mentor_id: z.string().uuid().optional(),
    mentor_query: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (v) =>
      (typeof v.mentee_id === "string" || typeof v.mentee_query === "string") &&
      (typeof v.mentor_id === "string" || typeof v.mentor_query === "string"),
    {
      message:
        "Expected a mentee (mentee_id or mentee_query) and a mentor (mentor_id or mentor_query)",
    }
  );

type Args = z.infer<typeof prepareMentorshipPairingSchema>;

/**
 * Admin-only write tool: turn a chosen mentor (one of the suggested candidates)
 * into a confirmable mentorship pairing. Mirrors the `prepare_*` pending-action
 * pattern — it does NOT pair directly; it builds a confirmation card whose
 * confirm runs the same `executeAdminPairing` routine as the admin board.
 *
 * Eligibility/score/signals are recomputed via `suggestMentorsForPairing`
 * (never trusts the LLM), so the chosen mentor must still be a live candidate.
 */
export const prepareMentorshipPairingModule: ToolModule<Args> = {
  name: "prepare_mentorship_pairing",
  argsSchema: prepareMentorshipPairingSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (ctx.authorization.kind !== "preverified_admin") {
      aiLog("info", "ai-tools", "prepare_mentorship_pairing unauthorized", logContext, {
        auth_decision: "unauthorized",
      });
      return {
        kind: "ok",
        data: {
          state: "unauthorized",
          message: "Creating mentorship pairings is currently admin-only.",
        },
      };
    }

    if (!ctx.threadId) {
      return toolError("Creating a mentorship pairing requires a thread context");
    }

    const { suggestMentorsForPairing } = await import("@/lib/mentorship/ai-suggestions");
    const supabase = sb as unknown as SupabaseClient<Database>;

    try {
      // Recompute candidates for this mentee so score/signals are authoritative
      // and we confirm the chosen mentor is still eligible.
      const ranking = await suggestMentorsForPairing(supabase, ctx.orgId, {
        menteeUserId: args.mentee_id,
        menteeQuery: args.mentee_query,
        limit: 50,
      });

      if (ranking.state === "not_found") {
        return {
          kind: "ok",
          data: {
            state: "mentee_not_found",
            message:
              "I couldn't find that student in the organization. Share a full name or email.",
          },
        };
      }
      if (ranking.state === "ambiguous") {
        return {
          kind: "ok",
          data: {
            state: "mentee_ambiguous",
            disambiguation_options: ranking.disambiguation_options ?? [],
          },
        };
      }
      if (ranking.state !== "resolved" || !ranking.mentee) {
        return {
          kind: "ok",
          data: { state: "no_candidates", message: "No eligible mentors are available right now." },
        };
      }

      // Resolve the chosen mentor among the live candidates.
      const candidates = ranking.candidates;
      let chosen = args.mentor_id
        ? candidates.find((c) => c.mentor.user_id === args.mentor_id)
        : undefined;

      if (!chosen && args.mentor_query) {
        const q = args.mentor_query.toLowerCase().trim();
        const nameMatches = candidates.filter((c) => c.mentor.name.toLowerCase().includes(q));
        const exact = nameMatches.find((c) => c.mentor.name.toLowerCase() === q);
        if (exact) chosen = exact;
        else if (nameMatches.length === 1) chosen = nameMatches[0];
        else if (nameMatches.length > 1) {
          return {
            kind: "ok",
            data: {
              state: "mentor_ambiguous",
              disambiguation_options: nameMatches.slice(0, 5).map((c) => c.mentor),
            },
          };
        }
      }

      if (!chosen) {
        return {
          kind: "ok",
          data: {
            state: "mentor_ineligible",
            mentee: ranking.mentee,
            message:
              "That mentor isn't an eligible match for this student right now (at capacity, already paired, or not found among the suggestions).",
          },
        };
      }

      const why = buildDeterministicWhy(
        chosen.reasons.map((r) => ({ code: r.code, value: r.value, weight: r.weight }))
      );

      const { data: org } = await supabase
        .from("organizations")
        .select("slug")
        .eq("id", ctx.orgId)
        .maybeSingle();

      const payload: CreateMentorshipPairingPendingPayload = {
        orgSlug: typeof org?.slug === "string" ? org.slug : null,
        mentee_user_id: ranking.mentee.user_id,
        mentee_name: ranking.mentee.name,
        mentor_user_id: chosen.mentor.user_id,
        mentor_name: chosen.mentor.name,
        match_score: chosen.score,
        confidence: chosen.confidence,
        match_signals: chosen.reasons.map((r) => ({
          code: r.code,
          weight: r.weight,
          value: r.value,
        })),
        why: why || null,
        is_fallback: chosen.isFallback,
      };

      const created = await createOrRevisePendingAction(sb, {
        organizationId: ctx.orgId,
        userId: ctx.userId,
        threadId: ctx.threadId,
        actionType: "create_mentorship_pairing",
        payload,
        activeActionId: ctx.activePendingActionId,
      });
      if ("failed" in created) return pendingActionFailureToToolError(created.reason);

      aiLog("info", "ai-tools", "prepare_mentorship_pairing prepared", logContext, {
        auth_decision: "allowed",
        confidence: chosen.confidence,
        is_fallback: chosen.isFallback,
      });

      return {
        kind: "ok",
        data: {
          state: "needs_confirmation",
          draft: {
            mentee: ranking.mentee,
            mentor: chosen.mentor,
            confidence: chosen.confidence,
            confidenceLabel: chosen.confidenceLabel,
            capacityRemaining: chosen.capacityRemaining,
            why: why || null,
            is_fallback: chosen.isFallback,
          },
          pending_action: buildPendingActionField(created, payload),
        },
      };
    } catch (error) {
      if (isStageTimeoutError(error)) throw error;
      aiLog("warn", "ai-tools", "prepare_mentorship_pairing failed", logContext, {
        error: getSafeErrorMessage(error),
      });
      return toolError("Unexpected error");
    }
  },
};
