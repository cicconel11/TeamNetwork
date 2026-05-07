import { z } from "zod";
import { assistantEventDraftSchema, assistantPreparedEventSchema } from "@/lib/schemas/events-ai";
import { createOrRevisePendingAction, type CreateEventPendingPayload } from "@/lib/ai/pending-actions";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import { prepareEventSchema } from "@/lib/ai/tools/prepare-schemas";
import { buildPendingActionField, pendingActionFailureToToolError, REQUIRED_PREPARED_EVENT_FIELDS } from "@/lib/ai/tools/prepare-tool-helpers";
import type { ToolModule } from "./types";

type Args = z.infer<typeof prepareEventSchema>;

export const prepareEventModule: ToolModule<Args> = {
  name: "prepare_event",
  argsSchema: prepareEventSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.threadId) {
      return toolError("Event preparation requires a thread context");
    }

    const normalized = Object.fromEntries(
      Object.entries(args).filter(
        ([, v]) => !(typeof v === "string" && v.trim().length === 0)
      )
    ) as Args;

    const draftWithDefaults = {
      ...normalized,
      event_type: normalized.event_type ?? "general",
      is_philanthropy: normalized.is_philanthropy ?? normalized.event_type === "philanthropy",
    };

    const parsedDraft = assistantEventDraftSchema.safeParse(draftWithDefaults);
    if (!parsedDraft.success) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: parsedDraft.error.issues.map((issue) => issue.path.join(".") || "body"),
          draft: draftWithDefaults,
        },
      };
    }

    const missingFields = REQUIRED_PREPARED_EVENT_FIELDS.filter((field) => {
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

    const prepared = assistantPreparedEventSchema.safeParse(parsedDraft.data);
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
      aiLog("warn", "ai-tools", "prepare_event org lookup failed", logContext, {
        error: getSafeErrorMessage(orgError),
      });
      return toolError("Failed to load organization context");
    }

    const pendingPayload: CreateEventPendingPayload = {
      ...prepared.data,
      orgSlug: typeof org?.slug === "string" ? org.slug : null,
    };
    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "create_event",
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
