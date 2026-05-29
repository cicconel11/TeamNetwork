import { z } from "zod";
import { sanitizeIlikeInput } from "@/lib/security/validation";
import { buildMemberName, safeToolQuery } from "@/lib/ai/tools/shared";
import type { ToolModule } from "./types";

const listAlumniSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    graduation_year: z.number().int().min(1900).max(2100).optional(),
    industry: z.string().trim().min(1).optional(),
    company: z.string().trim().min(1).optional(),
    city: z.string().trim().min(1).optional(),
    // Substring match within the enriched jsonb arrays (e.g. skill "AWS",
    // language "Spanish", certification "PMP").
    skill: z.string().trim().min(1).optional(),
    certification: z.string().trim().min(1).optional(),
    language: z.string().trim().min(1).optional(),
  })
  .strict();

type Args = z.infer<typeof listAlumniSchema>;

export const listAlumniModule: ToolModule<Args> = {
  name: "list_alumni",
  argsSchema: listAlumniSchema,
  async execute(args, { ctx, sb, logContext }) {
    const limit = Math.min(args.limit ?? 10, 25);
    return safeToolQuery(logContext, async () => {
      let query = sb
        .from("alumni")
        .select(
          "id, first_name, last_name, graduation_year, current_company, industry, current_city, position_title, job_title, linkedin_url, email, headline, summary, skills, certifications, languages"
        )
        .eq("organization_id", ctx.orgId)
        .is("deleted_at", null)
        .order("graduation_year", { ascending: false })
        .limit(limit);

      if (args.graduation_year !== undefined) {
        query = query.eq("graduation_year", args.graduation_year);
      }
      if (args.industry) {
        query = query.ilike("industry", `%${sanitizeIlikeInput(args.industry)}%`);
      }
      if (args.company) {
        query = query.ilike("current_company", `%${sanitizeIlikeInput(args.company)}%`);
      }
      if (args.city) {
        query = query.ilike("current_city", `%${sanitizeIlikeInput(args.city)}%`);
      }
      // jsonb arrays: cast to text so substring matching works across elements.
      if (args.skill) {
        query = query.ilike("skills::text", `%${sanitizeIlikeInput(args.skill)}%`);
      }
      if (args.certification) {
        query = query.ilike("certifications::text", `%${sanitizeIlikeInput(args.certification)}%`);
      }
      if (args.language) {
        query = query.ilike("languages::text", `%${sanitizeIlikeInput(args.language)}%`);
      }

      const { data, error } = await query;

      if (!Array.isArray(data) || error) {
        return { data, error };
      }

      return {
        data: data.map((row) => ({
          id: row.id,
          name: buildMemberName(row.first_name ?? "", row.last_name ?? ""),
          graduation_year: row.graduation_year ?? null,
          current_company: row.current_company ?? null,
          industry: row.industry ?? null,
          current_city: row.current_city ?? null,
          title: row.position_title ?? row.job_title ?? null,
          linkedin_url: row.linkedin_url ?? null,
          email: row.email ?? null,
          headline: row.headline ?? null,
          summary: row.summary ?? null,
          skills: row.skills ?? null,
          certifications: row.certifications ?? null,
          languages: row.languages ?? null,
        })),
        error: null,
      };
    });
  },
};
