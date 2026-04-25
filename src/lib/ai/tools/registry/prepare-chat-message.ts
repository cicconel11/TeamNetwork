import { z } from "zod";
import {
  assistantChatMessageDraftSchema,
  assistantPreparedChatMessageSchema,
} from "@/lib/schemas/chat-ai";
import { resolveChatMessageRecipient, type DirectChatSupabase } from "@/lib/chat/direct-chat";
import { createOrRevisePendingAction, type SendChatMessagePendingPayload } from "@/lib/ai/pending-actions";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import { prepareChatMessageSchema } from "@/lib/ai/tools/prepare-schemas";
import { buildPendingActionField, pendingActionFailureToToolError, sanitizeDraftValue } from "@/lib/ai/tools/prepare-tool-helpers";
import type { ToolModule } from "./types";

type Args = z.infer<typeof prepareChatMessageSchema>;

export const prepareChatMessageModule: ToolModule<Args> = {
  name: "prepare_chat_message",
  argsSchema: prepareChatMessageSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.threadId) {
      return toolError("Chat message preparation requires a thread context");
    }

    const normalizedDraft = {
      ...Object.fromEntries(
        Object.entries({
          recipient_member_id: args.recipient_member_id,
          person_query: sanitizeDraftValue(args.person_query),
          body: sanitizeDraftValue(args.body),
        }).filter(([, value]) => value !== undefined)
      ),
    };

    const parsedDraft = assistantChatMessageDraftSchema.safeParse(normalizedDraft);
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

    const recipientResolution = await resolveChatMessageRecipient(sb as DirectChatSupabase, {
      organizationId: ctx.orgId,
      senderUserId: ctx.userId,
      recipientMemberId: parsedDraft.data.recipient_member_id,
      personQuery: parsedDraft.data.person_query,
    });

    if (recipientResolution.kind === "recipient_required") {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: [
            ...(parsedDraft.data.body ? [] : ["body"]),
            "person_query",
          ],
          clarification_kind: "recipient_required",
          draft: parsedDraft.data,
        },
      };
    }

    if (recipientResolution.kind === "ambiguous") {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: [
            ...(parsedDraft.data.body ? [] : ["body"]),
            "person_query",
          ],
          clarification_kind: "recipient_ambiguous",
          requested_recipient: recipientResolution.requestedRecipient,
          candidate_recipients: recipientResolution.candidateRecipients,
          draft: parsedDraft.data,
        },
      };
    }

    if (recipientResolution.kind === "unavailable") {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: parsedDraft.data.body ? [] : ["body"],
          clarification_kind: "recipient_unavailable",
          requested_recipient: recipientResolution.requestedRecipient ?? null,
          unavailable_reason: recipientResolution.reason,
          draft: parsedDraft.data,
        },
      };
    }

    const draftWithResolvedRecipient = {
      ...parsedDraft.data,
      recipient_member_id: recipientResolution.memberId,
    };

    if (!parsedDraft.data.body) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: ["body"],
          draft: draftWithResolvedRecipient,
        },
      };
    }

    const prepared = assistantPreparedChatMessageSchema.safeParse({
      recipient_member_id: recipientResolution.memberId,
      recipient_user_id: recipientResolution.userId,
      recipient_display_name: recipientResolution.displayName,
      body: parsedDraft.data.body,
      existing_chat_group_id: recipientResolution.existingChatGroupId ?? undefined,
    });

    if (!prepared.success) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: prepared.error.issues.map((issue) => issue.path.join(".") || "body"),
          draft: draftWithResolvedRecipient,
        },
      };
    }

    const { data: org, error: orgError } = await sb
      .from("organizations")
      .select("slug")
      .eq("id", ctx.orgId)
      .maybeSingle();

    if (orgError) {
      aiLog("warn", "ai-tools", "prepare_chat_message org lookup failed", logContext, {
        error: getSafeErrorMessage(orgError),
      });
      return toolError("Failed to load organization context");
    }

    const pendingPayload: SendChatMessagePendingPayload = {
      ...prepared.data,
      orgSlug: typeof org?.slug === "string" ? org.slug : null,
    };
    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "send_chat_message",
      payload: pendingPayload,
      activeActionId: ctx.activePendingActionId,
    });
    if ("failed" in created) return pendingActionFailureToToolError(created.reason);
    return {
      kind: "ok",
      data: {
        state: "needs_confirmation",
        draft: draftWithResolvedRecipient,
        pending_action: buildPendingActionField(created, pendingPayload),
      },
    };
  },
};
