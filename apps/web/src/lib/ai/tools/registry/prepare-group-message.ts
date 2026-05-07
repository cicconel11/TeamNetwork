import { z } from "zod";
import {
  assistantGroupMessageDraftSchema,
  assistantPreparedGroupMessageSchema,
} from "@/lib/schemas/chat-ai";
import { resolveGroupChatTarget, type GroupChatSupabase } from "@/lib/chat/group-chat";
import { createOrRevisePendingAction, type SendGroupChatMessagePendingPayload } from "@/lib/ai/pending-actions";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import { prepareGroupMessageSchema } from "@/lib/ai/tools/prepare-schemas";
import { buildPendingActionField, pendingActionFailureToToolError, sanitizeDraftValue } from "@/lib/ai/tools/prepare-tool-helpers";
import type { ToolModule } from "./types";

type Args = z.infer<typeof prepareGroupMessageSchema>;

export const prepareGroupMessageModule: ToolModule<Args> = {
  name: "prepare_group_message",
  argsSchema: prepareGroupMessageSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.threadId) {
      return toolError("Group message preparation requires a thread context");
    }

    const normalizedDraft = {
      ...Object.fromEntries(
        Object.entries({
          chat_group_id: args.chat_group_id,
          group_name_query: sanitizeDraftValue(args.group_name_query),
          body: sanitizeDraftValue(args.body),
        }).filter(([, value]) => value !== undefined)
      ),
    };

    const parsedDraft = assistantGroupMessageDraftSchema.safeParse(normalizedDraft);
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

    const groupResolution = await resolveGroupChatTarget(sb as GroupChatSupabase, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      chatGroupId: parsedDraft.data.chat_group_id,
      groupNameQuery: parsedDraft.data.group_name_query,
    });

    if (groupResolution.kind === "group_required") {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: [
            ...(parsedDraft.data.body ? [] : ["body"]),
            "group_name_query",
          ],
          clarification_kind: "group_required",
          draft: parsedDraft.data,
        },
      };
    }

    if (groupResolution.kind === "ambiguous") {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: [
            ...(parsedDraft.data.body ? [] : ["body"]),
            "group_name_query",
          ],
          clarification_kind: "group_ambiguous",
          requested_group: groupResolution.requestedGroup,
          candidate_groups: groupResolution.candidateGroups,
          draft: parsedDraft.data,
        },
      };
    }

    if (groupResolution.kind === "unavailable") {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: parsedDraft.data.body ? [] : ["body"],
          clarification_kind: "group_unavailable",
          requested_group: groupResolution.requestedGroup ?? null,
          unavailable_reason: groupResolution.reason,
          draft: parsedDraft.data,
        },
      };
    }

    const draftWithResolvedGroup = {
      ...parsedDraft.data,
      chat_group_id: groupResolution.chatGroupId,
    };

    if (!parsedDraft.data.body) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: ["body"],
          draft: draftWithResolvedGroup,
        },
      };
    }

    const prepared = assistantPreparedGroupMessageSchema.safeParse({
      chat_group_id: groupResolution.chatGroupId,
      group_name: groupResolution.groupName,
      message_status: groupResolution.messageStatus,
      body: parsedDraft.data.body,
    });

    if (!prepared.success) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: prepared.error.issues.map((issue) => issue.path.join(".") || "body"),
          draft: draftWithResolvedGroup,
        },
      };
    }

    const { data: org, error: orgError } = await sb
      .from("organizations")
      .select("slug")
      .eq("id", ctx.orgId)
      .maybeSingle();

    if (orgError) {
      aiLog("warn", "ai-tools", "prepare_group_message org lookup failed", logContext, {
        error: getSafeErrorMessage(orgError),
      });
      return toolError("Failed to load organization context");
    }

    const pendingPayload: SendGroupChatMessagePendingPayload = {
      ...prepared.data,
      orgSlug: typeof org?.slug === "string" ? org.slug : null,
    };
    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "send_group_chat_message",
      payload: pendingPayload,
      activeActionId: ctx.activePendingActionId,
    });
    if ("failed" in created) return pendingActionFailureToToolError(created.reason);
    return {
      kind: "ok",
      data: {
        state: "needs_confirmation",
        draft: draftWithResolvedGroup,
        pending_action: buildPendingActionField(created, pendingPayload),
      },
    };
  },
};
