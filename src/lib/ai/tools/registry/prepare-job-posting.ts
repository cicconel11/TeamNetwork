import { z } from "zod";
import { assistantJobDraftSchema, assistantPreparedJobSchema } from "@/lib/schemas/jobs";
import { fetchJobSourceDraft, JobSourceIntakeError } from "@/lib/jobs/source-intake";
import { createOrRevisePendingAction, type CreateJobPostingPendingPayload } from "@/lib/ai/pending-actions";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import { prepareJobPostingSchema } from "@/lib/ai/tools/prepare-schemas";
import {
  buildPendingActionField,
  hasPreparedJobRequirements,
  mergeDrafts,
  normalizeAssistantDraft,
  pendingActionFailureToToolError,
  REQUIRED_PREPARED_JOB_FIELDS,
} from "@/lib/ai/tools/prepare-tool-helpers";
import type { ToolModule } from "./types";

type Args = z.infer<typeof prepareJobPostingSchema>;

export const prepareJobPostingModule: ToolModule<Args> = {
  name: "prepare_job_posting",
  argsSchema: prepareJobPostingSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.threadId) {
      return toolError("Job preparation requires a thread context");
    }

    const parsedDraft = assistantJobDraftSchema.safeParse(normalizeAssistantDraft(args));
    if (!parsedDraft.success) {
      return toolError("Invalid job draft");
    }

    let sourceDraft: Partial<Args> = {};
    let sourceWarning: string | null = null;
    if (parsedDraft.data.application_url && !hasPreparedJobRequirements(parsedDraft.data)) {
      try {
        sourceDraft = await fetchJobSourceDraft(parsedDraft.data.application_url);
      } catch (error) {
        if (error instanceof JobSourceIntakeError) {
          sourceWarning = error.message;
        }
        if (!(error instanceof JobSourceIntakeError)) {
          return toolError("Unable to read the job posting URL");
        }
      }
    }

    const mergedDraft = mergeDrafts(parsedDraft.data, sourceDraft);
    const missingFields = REQUIRED_PREPARED_JOB_FIELDS.filter((field) => {
      const value = mergedDraft[field];
      return typeof value !== "string" || value.trim().length === 0;
    });

    const hasApplicationUrl =
      typeof mergedDraft.application_url === "string" && mergedDraft.application_url.trim().length > 0;
    const hasContactEmail =
      typeof mergedDraft.contact_email === "string" && mergedDraft.contact_email.trim().length > 0;
    if (!hasApplicationUrl && !hasContactEmail) {
      missingFields.push("application_url");
    }

    if (missingFields.length > 0) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: Array.from(new Set(missingFields)),
          draft: mergedDraft,
          sourced_fields: Object.keys(sourceDraft),
          ...(sourceWarning ? { source_warning: sourceWarning } : {}),
        },
      };
    }

    const prepared = assistantPreparedJobSchema.safeParse(mergedDraft);
    if (!prepared.success) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: prepared.error.issues.map((issue) => issue.path.join(".") || "body"),
          draft: mergedDraft,
          sourced_fields: Object.keys(sourceDraft),
          ...(sourceWarning ? { source_warning: sourceWarning } : {}),
        },
      };
    }

    const { data: org, error: orgError } = await sb
      .from("organizations")
      .select("slug")
      .eq("id", ctx.orgId)
      .maybeSingle();

    if (orgError) {
      aiLog("warn", "ai-tools", "prepare_job_posting org lookup failed", logContext, {
        error: getSafeErrorMessage(orgError),
      });
      return toolError("Failed to load organization context");
    }

    const pendingPayload: CreateJobPostingPendingPayload = {
      ...prepared.data,
      orgSlug: typeof org?.slug === "string" ? org.slug : null,
    };
    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "create_job_posting",
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
        sourced_fields: Object.keys(sourceDraft),
      },
    };
  },
};
