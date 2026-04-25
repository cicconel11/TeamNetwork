import { z } from "zod";
import {
  assistantAnnouncementDraftSchema,
  assistantPreparedAnnouncementSchema,
} from "@/lib/schemas/content";
import { createOrRevisePendingAction, type CreateAnnouncementPendingPayload } from "@/lib/ai/pending-actions";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import { prepareAnnouncementSchema } from "@/lib/ai/tools/prepare-schemas";
import {
  buildPendingActionField,
  pendingActionFailureToToolError,
  REQUIRED_PREPARED_ANNOUNCEMENT_FIELDS,
  sanitizeDraftValue,
} from "@/lib/ai/tools/prepare-tool-helpers";
import type { ToolModule } from "./types";

type Args = z.infer<typeof prepareAnnouncementSchema>;

export const prepareAnnouncementModule: ToolModule<Args> = {
  name: "prepare_announcement",
  argsSchema: prepareAnnouncementSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.threadId) {
      return toolError("Announcement preparation requires a thread context");
    }

    const normalizedDraft = {
      ...Object.fromEntries(
        Object.entries({
          ...args,
          title: sanitizeDraftValue(args.title),
          body: sanitizeDraftValue(args.body),
        }).filter(([, value]) => value !== undefined)
      ),
      audience: args.audience ?? "all",
      is_pinned: args.is_pinned ?? false,
      send_notification: args.send_notification ?? false,
    };

    const parsedDraft = assistantAnnouncementDraftSchema.safeParse(normalizedDraft);
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

    const missingFields = REQUIRED_PREPARED_ANNOUNCEMENT_FIELDS.filter((field) => {
      const value = parsedDraft.data[field];
      return typeof value !== "string" || value.trim().length === 0;
    });

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

    const prepared = assistantPreparedAnnouncementSchema.safeParse(parsedDraft.data);
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
      aiLog("warn", "ai-tools", "prepare_announcement org lookup failed", logContext, {
        error: getSafeErrorMessage(orgError),
      });
      return toolError("Failed to load organization context");
    }

    const pendingPayload: CreateAnnouncementPendingPayload = {
      ...prepared.data,
      orgSlug: typeof org?.slug === "string" ? org.slug : null,
    };
    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "create_announcement",
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
