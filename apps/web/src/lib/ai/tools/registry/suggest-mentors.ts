import { z } from "zod";
import { isStageTimeoutError } from "@/lib/ai/timeout";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import type { ToolModule } from "./types";

/**
 * Accept either a single string or an array of strings, normalizing to an
 * array. Tolerates glm-5.2 emitting a bare string where the schema expects a
 * list, without weakening the per-element validation.
 */
const stringOrStringArray = z
  .union([z.string().trim().min(1), z.array(z.string().trim().min(1))])
  .transform((value) => (Array.isArray(value) ? value : [value]));

// NOTE: no `.strict()` — unknown keys emitted by the model are stripped rather
// than rejected. The `.refine()` below still enforces the real "at least one
// criterion" contract.
const suggestMentorsSchema = z
  .object({
    mentee_id: z.string().uuid().optional(),
    mentee_query: z.string().trim().min(1).optional(),
    focus_areas: stringOrStringArray.optional(),
    topics: stringOrStringArray.optional(),
    industries: stringOrStringArray.optional(),
    role_families: stringOrStringArray.optional(),
    goals: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(25).optional(),
  })
  .refine(
    (value) =>
      (typeof value.mentee_query === "string" && value.mentee_query.length > 0) ||
      typeof value.mentee_id === "string" ||
      (Array.isArray(value.focus_areas) && value.focus_areas.length > 0) ||
      (Array.isArray(value.topics) && value.topics.length > 0) ||
      (Array.isArray(value.industries) && value.industries.length > 0) ||
      (Array.isArray(value.role_families) && value.role_families.length > 0) ||
      (typeof value.goals === "string" && value.goals.length > 0),
    {
      message: "Expected mentee_query, mentee_id, or mentorship criteria",
    },
  );

type Args = z.infer<typeof suggestMentorsSchema>;

export const suggestMentorsModule: ToolModule<Args> = {
  name: "suggest_mentors",
  argsSchema: suggestMentorsSchema,
  async execute(args, { ctx, sb, logContext }) {
    // Amendment D: admin-only in v1
    if (ctx.authorization.kind !== "preverified_admin") {
      aiLog("info", "ai-tools", "suggest_mentors unauthorized", logContext, {
        auth_decision: "unauthorized",
      });
      return {
        kind: "ok",
        data: { state: "unauthorized", message: "Mentor suggestions are currently admin-only." },
      };
    }

    const { suggestMentors } = await import("@/lib/mentorship/ai-suggestions");

    try {
      const data = await suggestMentors(
        sb as unknown as import("@supabase/supabase-js").SupabaseClient<
          import("@/types/database").Database
        >,
        ctx.orgId,
        {
          menteeUserId: args.mentee_id,
          menteeQuery: args.mentee_query,
          focusAreas: args.focus_areas,
          topics: args.topics,
          industries: args.industries,
          roleFamilies: args.role_families,
          goals: args.goals,
          limit: args.limit,
        },
      );

      aiLog("info", "ai-tools", "suggest_mentors completed", logContext, {
        auth_decision: "allowed",
        state: data.state,
        candidate_count: data.suggestions.length,
        top_reason_codes: data.suggestions[0]?.reasons.map((r) => r.code) ?? [],
      });

      return { kind: "ok", data };
    } catch (error) {
      if (isStageTimeoutError(error)) throw error;

      aiLog("warn", "ai-tools", "suggest_mentors failed", logContext, {
        error: getSafeErrorMessage(error),
      });
      return toolError("Unexpected error");
    }
  },
};
