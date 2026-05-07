import { z } from "zod";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import { prepareEventsBatchSchema } from "@/lib/ai/tools/prepare-schemas";
import { buildPendingEventBatchFromDrafts } from "@/lib/ai/tools/prepare-tool-helpers";
import type { ToolModule } from "./types";

type Args = z.infer<typeof prepareEventsBatchSchema>;

export const prepareEventsBatchModule: ToolModule<Args> = {
  name: "prepare_events_batch",
  argsSchema: prepareEventsBatchSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.threadId) {
      return toolError("Event preparation requires a thread context");
    }

    const { data: org, error: orgError } = await sb
      .from("organizations")
      .select("slug")
      .eq("id", ctx.orgId)
      .maybeSingle();

    if (orgError) {
      aiLog("warn", "ai-tools", "prepare_events_batch org lookup failed", logContext, {
        error: getSafeErrorMessage(orgError),
      });
      return toolError("Failed to load organization context");
    }

    const orgSlug = typeof org?.slug === "string" ? org.slug : null;
    return {
      kind: "ok",
      data: await buildPendingEventBatchFromDrafts(sb, ctx, args.events, logContext, orgSlug),
    };
  },
};
