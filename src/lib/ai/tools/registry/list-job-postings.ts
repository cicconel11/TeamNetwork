import { z } from "zod";
import { safeToolQuery, truncateBody } from "@/lib/ai/tools/shared";
import type { ToolModule } from "./types";

const listJobPostingsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
  })
  .strict();

type Args = z.infer<typeof listJobPostingsSchema>;

export const listJobPostingsModule: ToolModule<Args> = {
  name: "list_job_postings",
  argsSchema: listJobPostingsSchema,
  async execute(args, { ctx, sb, logContext }) {
    const limit = Math.min(args.limit ?? 10, 25);
    return safeToolQuery(logContext, async () => {
      const { data, error } = await sb
        .from("job_postings")
        .select("id, title, company, location, job_type, description, created_at")
        .eq("organization_id", ctx.orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!Array.isArray(data) || error) {
        return { data, error };
      }

      return {
        data: data.map((job) => ({
          id: job.id,
          title: job.title,
          company: job.company ?? null,
          location: job.location ?? null,
          job_type: job.job_type ?? null,
          created_at: job.created_at ?? null,
          description_preview: truncateBody(job.description),
        })),
        error: null,
      };
    });
  },
};
