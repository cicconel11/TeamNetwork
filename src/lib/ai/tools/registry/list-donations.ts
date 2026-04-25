import { z } from "zod";
import { safeToolQuery } from "@/lib/ai/tools/shared";
import { sanitizeIlikeInput } from "@/lib/security/validation";
import type { ToolModule } from "./types";

const listDonationsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    status: z.enum(["succeeded", "failed", "pending"]).optional(),
    purpose: z.string().trim().min(1).optional(),
  })
  .strict();

type Args = z.infer<typeof listDonationsSchema>;

export const listDonationsModule: ToolModule<Args> = {
  name: "list_donations",
  argsSchema: listDonationsSchema,
  async execute(args, { ctx, sb, logContext }) {
    const limit = Math.min(args.limit ?? 10, 25);
    return safeToolQuery(logContext, async () => {
      let query = sb
        .from("organization_donations")
        .select("id, donor_name, donor_email, amount_cents, purpose, status, created_at, anonymous")
        .eq("organization_id", ctx.orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (args.status) {
        query = query.eq("status", args.status);
      }
      if (args.purpose) {
        query = query.ilike("purpose", `%${sanitizeIlikeInput(args.purpose)}%`);
      }

      const { data, error } = await query;

      if (!Array.isArray(data) || error) {
        return { data, error };
      }

      return {
        data: data.map((row: Record<string, unknown>) => {
          const isAnonymous = Boolean(row.anonymous);
          return {
            id: row.id,
            donor_name: isAnonymous ? "Anonymous" : (row.donor_name ?? null),
            donor_email: isAnonymous ? "Anonymous" : (row.donor_email ?? null),
            amount_dollars: typeof row.amount_cents === "number" ? row.amount_cents / 100 : null,
            purpose: row.purpose ?? null,
            status: row.status ?? null,
            created_at: row.created_at ?? null,
            anonymous: isAnonymous,
          };
        }),
        error: null,
      };
    });
  },
};
