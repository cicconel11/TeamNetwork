import type { z } from "zod";
import { editAnnouncementSchema, type EditAnnouncementForm } from "@/lib/schemas/content";
import {
  createOrRevisePendingAction,
  type UpdateAnnouncementPendingPayload,
} from "@/lib/ai/pending-actions";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import { prepareUpdateAnnouncementSchema } from "@/lib/ai/tools/prepare-schemas";
import {
  buildPendingActionField,
  pendingActionFailureToToolError,
  sanitizeDraftValue,
} from "@/lib/ai/tools/prepare-tool-helpers";
import type { ToolModule } from "./types";

type Args = z.infer<typeof prepareUpdateAnnouncementSchema>;

interface ExistingAnnouncementRow {
  id: string;
  title: string | null;
  body: string | null;
  is_pinned: boolean | null;
  audience: string | null;
}

const ALLOWED_AUDIENCES = new Set([
  "all",
  "members",
  "active_members",
  "alumni",
  "individuals",
]);

function coerceAudience(value: string | null | undefined): EditAnnouncementForm["audience"] {
  if (typeof value === "string" && ALLOWED_AUDIENCES.has(value)) {
    return value as EditAnnouncementForm["audience"];
  }
  return "all";
}

export const prepareUpdateAnnouncementModule: ToolModule<Args> = {
  name: "prepare_update_announcement",
  argsSchema: prepareUpdateAnnouncementSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.threadId) {
      return toolError("Announcement edits require a thread context");
    }

    const { data: row, error: lookupError } = await sb
      .from("announcements")
      .select("id, title, body, is_pinned, audience")
      .eq("id", args.announcement_id)
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (lookupError) {
      aiLog("warn", "ai-tools", "prepare_update_announcement lookup failed", logContext, {
        error: getSafeErrorMessage(lookupError),
      });
      return toolError("Failed to load announcement");
    }
    if (!row) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: ["announcement_id"],
          draft: { announcement_id: args.announcement_id },
        },
      };
    }

    const existing = row as ExistingAnnouncementRow;
    const newTitle = sanitizeDraftValue(args.title) ?? existing.title ?? "";
    const newBody = (() => {
      if (typeof args.body === "string") {
        const trimmed = args.body.trim();
        return trimmed.length > 0 ? trimmed : "";
      }
      return existing.body ?? "";
    })();
    const newPinned = args.is_pinned ?? Boolean(existing.is_pinned);
    const newAudience = args.audience ?? coerceAudience(existing.audience);

    const merged: EditAnnouncementForm = {
      title: newTitle,
      body: newBody,
      is_pinned: newPinned,
      audience: newAudience,
    };

    const validated = editAnnouncementSchema.safeParse(merged);
    if (!validated.success) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: validated.error.issues.map((issue) => issue.path.join(".") || "body"),
          draft: merged,
        },
      };
    }

    const { data: org, error: orgError } = await sb
      .from("organizations")
      .select("slug")
      .eq("id", ctx.orgId)
      .maybeSingle();

    if (orgError) {
      aiLog("warn", "ai-tools", "prepare_update_announcement org lookup failed", logContext, {
        error: getSafeErrorMessage(orgError),
      });
      return toolError("Failed to load organization context");
    }

    const pendingPayload: UpdateAnnouncementPendingPayload = {
      ...validated.data,
      announcement_id: args.announcement_id,
      orgSlug: typeof org?.slug === "string" ? org.slug : null,
      previous_title: existing.title,
      previous_body: existing.body,
    };

    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "update_announcement",
      payload: pendingPayload,
      activeActionId: ctx.activePendingActionId,
    });
    if ("failed" in created) return pendingActionFailureToToolError(created.reason);

    return {
      kind: "ok",
      data: {
        state: "needs_confirmation",
        draft: validated.data,
        pending_action: buildPendingActionField(created, pendingPayload),
      },
    };
  },
};
