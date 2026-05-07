import { z } from "zod";
import { listEnterpriseAlumni } from "@/lib/ai/tools/enterprise/list-alumni";
import { toolError } from "@/lib/ai/tools/result";
import { safeToolQuery } from "@/lib/ai/tools/shared";
import type { ToolModule } from "./types";

const listEnterpriseAlumniSchema = z
  .object({
    org: z.string().trim().min(1).optional(),
    graduation_year: z.number().int().min(1900).max(2100).optional(),
    industry: z.string().trim().min(1).optional(),
    company: z.string().trim().min(1).optional(),
    city: z.string().trim().min(1).optional(),
    position: z.string().trim().min(1).optional(),
    has_email: z.boolean().optional(),
    has_phone: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).max(5000).optional(),
  })
  .strict();

type Args = z.infer<typeof listEnterpriseAlumniSchema>;

export const listEnterpriseAlumniModule: ToolModule<Args> = {
  name: "list_enterprise_alumni",
  argsSchema: listEnterpriseAlumniSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.enterpriseId) {
      return toolError("enterprise context required");
    }
    return safeToolQuery(logContext, () =>
      listEnterpriseAlumni(sb, ctx.enterpriseId!, args),
    );
  },
};
