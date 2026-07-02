import { z } from "zod";
import { isStageTimeoutError } from "@/lib/ai/timeout";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage, stringOrStringArray } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import type { ToolModule } from "./types";

// NOTE: no `.strict()` — unknown keys emitted by the model are stripped rather
// than rejected. The `.refine()` below still enforces the real "at least one
// criterion" contract.
const suggestMenteesSchema = z
  .object({
    mentor_id: z.string().uuid().optional(),
    mentor_query: z.string().trim().min(1).optional(),
    topics: stringOrStringArray.optional(),
    industries: stringOrStringArray.optional(),
    role_families: stringOrStringArray.optional(),
    goals: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(25).optional(),
  })
  .refine(
    (value) =>
      (typeof value.mentor_query === "string" && value.mentor_query.length > 0) ||
      typeof value.mentor_id === "string" ||
      (Array.isArray(value.topics) && value.topics.length > 0) ||
      (Array.isArray(value.industries) && value.industries.length > 0) ||
      (Array.isArray(value.role_families) && value.role_families.length > 0) ||
      (typeof value.goals === "string" && value.goals.length > 0),
    {
      message: "Expected mentor_query, mentor_id, or mentorship criteria",
    },
  );

type Args = z.infer<typeof suggestMenteesSchema>;

export const suggestMenteesModule: ToolModule<Args> = {
  name: "suggest_mentees",
  argsSchema: suggestMenteesSchema,
  async execute(args, { ctx, sb, logContext }) {
    // Admin-only in v1, matching suggest_mentors (Amendment D).
    if (ctx.authorization.kind !== "preverified_admin") {
      aiLog("info", "ai-tools", "suggest_mentees unauthorized", logContext, {
        auth_decision: "unauthorized",
      });
      return {
        kind: "ok",
        data: { state: "unauthorized", message: "Mentee suggestions are currently admin-only." },
      };
    }

    const { suggestMentees } = await import("@/lib/mentorship/ai-suggestions");

    try {
      const data = await suggestMentees(
        sb as unknown as import("@supabase/supabase-js").SupabaseClient<
          import("@/types/database").Database
        >,
        ctx.orgId,
        {
          mentorUserId: args.mentor_id,
          mentorQuery: args.mentor_query,
          topics: args.topics,
          industries: args.industries,
          roleFamilies: args.role_families,
          goals: args.goals,
          limit: args.limit,
        },
      );

      aiLog("info", "ai-tools", "suggest_mentees completed", logContext, {
        auth_decision: "allowed",
        state: data.state,
        candidate_count: data.suggestions.length,
        top_reason_codes: data.suggestions[0]?.reasons.map((r) => r.code) ?? [],
      });

      return { kind: "ok", data };
    } catch (error) {
      if (isStageTimeoutError(error)) throw error;

      aiLog("warn", "ai-tools", "suggest_mentees failed", logContext, {
        error: getSafeErrorMessage(error),
      });
      return toolError("Unexpected error");
    }
  },
};
