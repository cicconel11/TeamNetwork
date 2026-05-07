import { z } from "zod";
import { safeToolQuery } from "@/lib/ai/tools/shared";
import { getEnterpriseOrgCapacity } from "@/lib/ai/tools/enterprise/quota";
import type { ToolModule } from "./types";

const getEnterpriseOrgCapacitySchema = z.object({}).strict();

type Args = z.infer<typeof getEnterpriseOrgCapacitySchema>;

export const getEnterpriseOrgCapacityModule: ToolModule<Args> = {
  name: "get_enterprise_org_capacity",
  argsSchema: getEnterpriseOrgCapacitySchema,
  async execute(_args, { ctx, sb, logContext }) {
    return safeToolQuery(logContext, () => getEnterpriseOrgCapacity(sb, ctx.enterpriseId!));
  },
};
