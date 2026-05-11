import type { z } from "zod";
import {
  createOrRevisePendingAction,
  type DeleteJobPostingPendingPayload,
} from "@/lib/ai/pending-actions";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import { prepareDeleteJobPostingSchema } from "@/lib/ai/tools/prepare-schemas";
import {
  buildPendingActionField,
  pendingActionFailureToToolError,
} from "@/lib/ai/tools/prepare-tool-helpers";
import type { ToolModule } from "./types";

type Args = z.infer<typeof prepareDeleteJobPostingSchema>;

interface JobRow {
  id: string;
  title: string;
  company: string;
}

interface JobQuery {
  select(columns: string): JobFilter;
}

interface JobFilter {
  eq(column: string, value: string): JobFilter;
  is(column: string, value: null): JobFilter;
  ilike(column: string, pattern: string): JobFilter;
  limit(count: number): Promise<{ data: JobRow[] | null; error: unknown }>;
  maybeSingle(): Promise<{ data: JobRow | null; error: unknown }>;
}

interface JobLookupClient {
  from(table: "job_postings"): JobQuery;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveJob(sb: unknown, orgId: string, args: Args) {
  const client = sb as JobLookupClient;
  if (args.job_id && UUID_PATTERN.test(args.job_id)) {
    const { data, error } = await client
      .from("job_postings")
      .select("id, title, company")
      .eq("id", args.job_id)
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
  const { data, error } = await client
    .from("job_postings")
    .select("id, title, company")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .ilike("title", `%${query}%`)
    .limit(5);
  if (error) return { kind: "error" as const, error };
  const rows = data ?? [];
  if (rows.length === 1) return { kind: "resolved" as const, row: rows[0] };
  if (rows.length > 1) return { kind: "ambiguous" as const, candidates: rows };
  return { kind: "missing" as const };
}

export const prepareDeleteJobPostingModule: ToolModule<Args> = {
  name: "prepare_delete_job_posting",
  argsSchema: prepareDeleteJobPostingSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.threadId) return toolError("Job deletion requires a thread context");

    const resolution = await resolveJob(sb, ctx.orgId, args);
    if (resolution.kind === "error") {
      aiLog("warn", "ai-tools", "prepare_delete_job_posting lookup failed", logContext, {
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

    const { data: org, error: orgError } = await sb
      .from("organizations")
      .select("slug")
      .eq("id", ctx.orgId)
      .maybeSingle();
    if (orgError) return toolError("Failed to load organization context");

    const pendingPayload: DeleteJobPostingPendingPayload = {
      job_id: resolution.row.id,
      title: resolution.row.title,
      company: resolution.row.company,
      orgSlug: typeof org?.slug === "string" ? org.slug : null,
    };

    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "delete_job_posting",
      payload: pendingPayload,
      activeActionId: ctx.activePendingActionId,
    });
    if ("failed" in created) return pendingActionFailureToToolError(created.reason);

    return {
      kind: "ok",
      data: {
        state: "needs_confirmation",
        draft: { job_id: resolution.row.id, title: resolution.row.title },
        pending_action: buildPendingActionField(created, pendingPayload),
      },
    };
  },
};
