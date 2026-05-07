import { z } from "zod";
import { safeToolQuery } from "@/lib/ai/tools/shared";
import { getEnterpriseStats } from "@/lib/ai/tools/enterprise/stats";
import type { ToolModule } from "./types";

const getEnterpriseStatsSchema = z.object({}).strict();

type Args = z.infer<typeof getEnterpriseStatsSchema>;

export const getEnterpriseStatsModule: ToolModule<Args> = {
  name: "get_enterprise_stats",
  argsSchema: getEnterpriseStatsSchema,
  async execute(_args, { ctx, sb, logContext }) {
    return safeToolQuery(logContext, () => getEnterpriseStats(sb, ctx.enterpriseId!));
  },
};
