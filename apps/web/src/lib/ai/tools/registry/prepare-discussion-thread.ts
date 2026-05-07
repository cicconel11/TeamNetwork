import { z } from "zod";
import {
  assistantDiscussionDraftSchema,
  assistantPreparedDiscussionSchema,
} from "@/lib/schemas/discussion";
import { createOrRevisePendingAction, type CreateDiscussionThreadPendingPayload } from "@/lib/ai/pending-actions";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import { prepareDiscussionThreadSchema } from "@/lib/ai/tools/prepare-schemas";
import { buildPendingActionField, pendingActionFailureToToolError } from "@/lib/ai/tools/prepare-tool-helpers";
import type { ToolModule } from "./types";

type Args = z.infer<typeof prepareDiscussionThreadSchema>;

export const prepareDiscussionThreadModule: ToolModule<Args> = {
  name: "prepare_discussion_thread",
  argsSchema: prepareDiscussionThreadSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.threadId) {
      return toolError("Discussion preparation requires a thread context");
    }

    const parsedDraft = assistantDiscussionDraftSchema.safeParse(args);
    if (!parsedDraft.success) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: parsedDraft.error.issues.map((issue) => issue.path.join(".") || "body"),
          draft: args,
        },
      };
    }

    const missingFields: string[] = [];
    if (!parsedDraft.data.title) missingFields.push("title");
    if (!parsedDraft.data.body) missingFields.push("body");

    if (missingFields.length > 0) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: missingFields,
          draft: parsedDraft.data,
        },
      };
    }

    const prepared = assistantPreparedDiscussionSchema.safeParse(parsedDraft.data);
    if (!prepared.success) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: prepared.error.issues.map((issue) => issue.path.join(".") || "body"),
          draft: parsedDraft.data,
        },
      };
    }

    const { data: org, error: orgError } = await sb
      .from("organizations")
      .select("slug")
      .eq("id", ctx.orgId)
      .maybeSingle();

    if (orgError) {
      aiLog("warn", "ai-tools", "prepare_discussion_thread org lookup failed", logContext, {
        error: getSafeErrorMessage(orgError),
      });
      return toolError("Failed to load organization context");
    }

    const pendingPayload: CreateDiscussionThreadPendingPayload = {
      ...prepared.data,
      orgSlug: typeof org?.slug === "string" ? org.slug : null,
    };
    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "create_discussion_thread",
      payload: pendingPayload,
      activeActionId: ctx.activePendingActionId,
    });
    if ("failed" in created) return pendingActionFailureToToolError(created.reason);
    return {
      kind: "ok",
      data: {
        state: "needs_confirmation",
        draft: prepared.data,
        pending_action: buildPendingActionField(created, pendingPayload),
      },
    };
  },
};
