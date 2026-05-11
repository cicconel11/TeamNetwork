import type { z } from "zod";
import { updateJobSchema, type UpdateJobForm } from "@/lib/schemas/jobs";
import {
  createOrRevisePendingAction,
  type UpdateJobPostingPendingPayload,
} from "@/lib/ai/pending-actions";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import { prepareUpdateJobPostingSchema } from "@/lib/ai/tools/prepare-schemas";
import {
  buildPendingActionField,
  pendingActionFailureToToolError,
  sanitizeDraftValue,
} from "@/lib/ai/tools/prepare-tool-helpers";
import type { ToolModule } from "./types";

type Args = z.infer<typeof prepareUpdateJobPostingSchema>;

interface JobRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  location_type: string | null;
  description: string;
  application_url: string | null;
  contact_email: string | null;
  industry: string | null;
  experience_level: string | null;
  expires_at: string | null;
  is_active: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveJob(sb: unknown, orgId: string, args: Args) {
  const client = sb as {
    from(table: "job_postings"): {
      select(columns: string): {
        eq(column: string, value: string): unknown;
      };
    };
  };

  if (args.job_id && UUID_PATTERN.test(args.job_id)) {
    const { data, error } = await (client.from("job_postings").select("*").eq("id", args.job_id) as {
      eq(column: string, value: string): { is(column: string, value: null): { maybeSingle(): Promise<{ data: JobRow | null; error: unknown }> } };
    })
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return { kind: "error" as const, error };
    return data ? { kind: "resolved" as const, row: data } : { kind: "missing" as const };
  }

  const fallbackId =
    args.job_id && !UUID_PATTERN.test(args.job_id) ? args.job_id.trim() : undefined;
  const query = args.job_query?.trim() || fallbackId;
  if (!query) return { kind: "missing" as const };

  const { data, error } = await (client.from("job_postings").select("*").eq("organization_id", orgId) as {
    is(column: string, value: null): {
      ilike(column: string, pattern: string): {
        limit(count: number): Promise<{ data: JobRow[] | null; error: unknown }>;
      };
    };
  })
    .is("deleted_at", null)
    .ilike("title", `%${query}%`)
    .limit(5);

  if (error) return { kind: "error" as const, error };
  const rows = data ?? [];
  if (rows.length === 1) return { kind: "resolved" as const, row: rows[0] };
  if (rows.length > 1) return { kind: "ambiguous" as const, candidates: rows };
  return { kind: "missing" as const };
}

export const prepareUpdateJobPostingModule: ToolModule<Args> = {
  name: "prepare_update_job_posting",
  argsSchema: prepareUpdateJobPostingSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.threadId) return toolError("Job edits require a thread context");

    const resolution = await resolveJob(sb, ctx.orgId, args);
    if (resolution.kind === "error") {
      aiLog("warn", "ai-tools", "prepare_update_job_posting lookup failed", logContext, {
        error: getSafeErrorMessage(resolution.error),
      });
      return toolError("Failed to load job posting");
    }
    if (resolution.kind === "missing" || resolution.kind === "ambiguous") {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: ["job_id"],
          draft: { job_id: args.job_id, job_query: args.job_query },
          ...(resolution.kind === "ambiguous"
            ? { candidates: resolution.candidates.map((job) => ({ id: job.id, title: job.title, company: job.company })) }
            : {}),
        },
      };
    }

    const existing = resolution.row;
    const merged: UpdateJobForm = {
      title: sanitizeDraftValue(args.title) ?? existing.title,
      company: sanitizeDraftValue(args.company) ?? existing.company,
      location: sanitizeDraftValue(args.location) ?? existing.location ?? undefined,
      location_type: args.location_type ?? (existing.location_type as UpdateJobForm["location_type"]),
      description: sanitizeDraftValue(args.description) ?? existing.description,
      application_url: sanitizeDraftValue(args.application_url) ?? existing.application_url ?? undefined,
      contact_email: sanitizeDraftValue(args.contact_email) ?? existing.contact_email ?? undefined,
      industry: sanitizeDraftValue(args.industry) ?? existing.industry ?? undefined,
      experience_level:
        args.experience_level ?? (existing.experience_level as UpdateJobForm["experience_level"]),
      expires_at: args.expires_at !== undefined ? args.expires_at : existing.expires_at,
      is_active: args.is_active ?? existing.is_active,
      mediaIds: args.mediaIds,
    };

    const validated = updateJobSchema.safeParse(merged);
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
    if (orgError) return toolError("Failed to load organization context");

    const pendingPayload: UpdateJobPostingPendingPayload = {
      ...validated.data,
      job_id: existing.id,
      orgSlug: typeof org?.slug === "string" ? org.slug : null,
      previous_title: existing.title,
      previous_company: existing.company,
      previous_location: existing.location,
      previous_description: existing.description,
      previous_is_active: existing.is_active,
    };

    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "update_job_posting",
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
