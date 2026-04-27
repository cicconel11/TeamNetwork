import type { z } from "zod";
import {
  createOrRevisePendingAction,
  type DeleteAnnouncementPendingPayload,
} from "@/lib/ai/pending-actions";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import { prepareDeleteAnnouncementSchema } from "@/lib/ai/tools/prepare-schemas";
import {
  buildPendingActionField,
  pendingActionFailureToToolError,
} from "@/lib/ai/tools/prepare-tool-helpers";
import type { ToolModule } from "./types";

type Args = z.infer<typeof prepareDeleteAnnouncementSchema>;

interface ExistingAnnouncementRow {
  id: string;
  title: string | null;
}

export const prepareDeleteAnnouncementModule: ToolModule<Args> = {
  name: "prepare_delete_announcement",
  argsSchema: prepareDeleteAnnouncementSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.threadId) {
      return toolError("Announcement deletion requires a thread context");
    }

    const { data: row, error: lookupError } = await sb
      .from("announcements")
      .select("id, title")
      .eq("id", args.announcement_id)
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (lookupError) {
      aiLog("warn", "ai-tools", "prepare_delete_announcement lookup failed", logContext, {
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

    const { data: org, error: orgError } = await sb
      .from("organizations")
      .select("slug")
      .eq("id", ctx.orgId)
      .maybeSingle();

    if (orgError) {
      aiLog("warn", "ai-tools", "prepare_delete_announcement org lookup failed", logContext, {
        error: getSafeErrorMessage(orgError),
      });
      return toolError("Failed to load organization context");
    }

    const pendingPayload: DeleteAnnouncementPendingPayload = {
      announcement_id: args.announcement_id,
      title: existing.title ?? "Announcement",
      orgSlug: typeof org?.slug === "string" ? org.slug : null,
    };

    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "delete_announcement",
      payload: pendingPayload,
      activeActionId: ctx.activePendingActionId,
    });
    if ("failed" in created) return pendingActionFailureToToolError(created.reason);

    return {
      kind: "ok",
      data: {
        state: "needs_confirmation",
        draft: { announcement_id: args.announcement_id, title: existing.title },
        pending_action: buildPendingActionField(created, pendingPayload),
      },
    };
  },
};
