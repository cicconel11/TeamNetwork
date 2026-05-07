import { z } from "zod";
import {
  assistantDiscussionReplyDraftSchema,
  assistantPreparedDiscussionReplySchema,
} from "@/lib/schemas/discussion";
import { createOrRevisePendingAction, type CreateDiscussionReplyPendingPayload } from "@/lib/ai/pending-actions";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import { prepareDiscussionReplySchema } from "@/lib/ai/tools/prepare-schemas";
import { buildPendingActionField, pendingActionFailureToToolError, sanitizeDraftValue } from "@/lib/ai/tools/prepare-tool-helpers";
import type { ToolModule } from "./types";

type Args = z.infer<typeof prepareDiscussionReplySchema>;

export const prepareDiscussionReplyModule: ToolModule<Args> = {
  name: "prepare_discussion_reply",
  argsSchema: prepareDiscussionReplySchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.threadId) {
      return toolError("Discussion reply preparation requires a thread context");
    }

    const normalizedDraft = {
      ...Object.fromEntries(
        Object.entries({
          ...args,
          thread_title: sanitizeDraftValue(args.thread_title),
          body: sanitizeDraftValue(args.body),
        }).filter(([, value]) => value !== undefined)
      ),
    };
    const parsedDraft = assistantDiscussionReplyDraftSchema.safeParse(normalizedDraft);
    if (!parsedDraft.success) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: parsedDraft.error.issues.map((issue) => issue.path.join(".") || "body"),
          draft: normalizedDraft,
        },
      };
    }

    const missingFields: string[] = [];
    if (!parsedDraft.data.discussion_thread_id) missingFields.push("discussion_thread_id");
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

    const prepared = assistantPreparedDiscussionReplySchema.safeParse(parsedDraft.data);
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
      aiLog("warn", "ai-tools", "prepare_discussion_reply org lookup failed", logContext, {
        error: getSafeErrorMessage(orgError),
      });
      return toolError("Failed to load organization context");
    }

    const pendingPayload: CreateDiscussionReplyPendingPayload = {
      ...prepared.data,
      orgSlug: typeof org?.slug === "string" ? org.slug : null,
    };
    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "create_discussion_reply",
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
