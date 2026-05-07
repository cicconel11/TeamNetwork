import { z } from "zod";
import { buildMemberName, safeToolQuery } from "@/lib/ai/tools/shared";
import { sanitizeIlikeInput } from "@/lib/security/validation";
import type { ToolModule } from "./types";

const listParentsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    relationship: z.string().trim().min(1).optional(),
  })
  .strict();

type Args = z.infer<typeof listParentsSchema>;

export const listParentsModule: ToolModule<Args> = {
  name: "list_parents",
  argsSchema: listParentsSchema,
  async execute(args, { ctx, sb, logContext }) {
    const limit = Math.min(args.limit ?? 10, 25);
    return safeToolQuery(logContext, async () => {
      let query = sb
        .from("parents")
        .select("id, first_name, last_name, email, relationship, student_name, phone_number")
        .eq("organization_id", ctx.orgId)
        .is("deleted_at", null)
        .order("last_name", { ascending: true })
        .limit(limit);

      if (args.relationship) {
        query = query.ilike("relationship", `%${sanitizeIlikeInput(args.relationship)}%`);
      }

      const { data, error } = await query;

      if (!Array.isArray(data) || error) {
        return { data, error };
      }

      return {
        data: data.map((row: Record<string, unknown>) => ({
          id: row.id,
          name: buildMemberName(String(row.first_name ?? ""), String(row.last_name ?? "")),
          relationship: row.relationship ?? null,
          student_name: row.student_name ?? null,
          email: row.email ?? null,
          phone_number: row.phone_number ?? null,
        })),
        error: null,
      };
    });
  },
};
