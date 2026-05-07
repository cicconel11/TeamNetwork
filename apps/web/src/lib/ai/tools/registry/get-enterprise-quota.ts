import { z } from "zod";
import { safeToolQuery } from "@/lib/ai/tools/shared";
import { getEnterpriseQuota } from "@/lib/ai/tools/enterprise/quota";
import type { ToolModule } from "./types";

const getEnterpriseQuotaSchema = z.object({}).strict();

type Args = z.infer<typeof getEnterpriseQuotaSchema>;

export const getEnterpriseQuotaModule: ToolModule<Args> = {
  name: "get_enterprise_quota",
  argsSchema: getEnterpriseQuotaSchema,
  async execute(_args, { ctx, sb, logContext }) {
    return safeToolQuery(logContext, () => getEnterpriseQuota(sb, ctx.enterpriseId!));
  },
};
