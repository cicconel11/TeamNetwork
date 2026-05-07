import { z } from "zod";
import { isStageTimeoutError } from "@/lib/ai/timeout";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import type { ToolModule } from "./types";

const suggestMentorsSchema = z
  .object({
    mentee_id: z.string().uuid().optional(),
    mentee_query: z.string().trim().min(1).optional(),
    focus_areas: z.array(z.string().trim().min(1)).optional(),
    limit: z.number().int().min(1).max(25).optional(),
  })
  .refine(
    (value) =>
      (typeof value.mentee_query === "string" && value.mentee_query.length > 0) ||
      typeof value.mentee_id === "string",
    {
      message: "Expected mentee_query or mentee_id",
    },
  )
  .strict();

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
