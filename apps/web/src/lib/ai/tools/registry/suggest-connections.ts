import { z } from "zod";
import { isStageTimeoutError } from "@/lib/ai/timeout";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import type { ToolModule } from "./types";

const suggestConnectionsSchema = z
  .object({
    person_type: z.enum(["member", "alumni"]).optional(),
    person_id: z.string().uuid().optional(),
    person_query: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(25).optional(),
  })
  .refine(
    (value) =>
      (typeof value.person_query === "string" && value.person_query.length > 0) ||
      (typeof value.person_type === "string" && typeof value.person_id === "string"),
    {
      message: "Expected person_query or both person_type and person_id",
    },
  )
  .strict();

type Args = z.infer<typeof suggestConnectionsSchema>;

export const suggestConnectionsModule: ToolModule<Args> = {
  name: "suggest_connections",
  argsSchema: suggestConnectionsSchema,
  async execute(args, { ctx, sb, logContext }) {
    const {
      suggestConnections,
      SuggestConnectionsLookupError,
    } = await import("@/lib/falkordb/suggestions");

    try {
      const data = await suggestConnections({
        orgId: ctx.orgId,
        serviceSupabase: sb,
        args,
      });

      return {
        kind: "ok",
        data,
      };
    } catch (error) {
      if (error instanceof SuggestConnectionsLookupError) {
        return toolError(error.message);
      }

      if (isStageTimeoutError(error)) {
        throw error;
      }

      aiLog("warn", "ai-tools", "suggest_connections failed", logContext, {
        error: getSafeErrorMessage(error),
      });
      return toolError("Unexpected error");
    }
  },
};
