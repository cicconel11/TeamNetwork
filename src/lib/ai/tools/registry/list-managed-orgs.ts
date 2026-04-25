import { z } from "zod";
import { safeToolQuery } from "@/lib/ai/tools/shared";
import { listManagedOrgs } from "@/lib/ai/tools/enterprise/managed-orgs";
import type { ToolModule } from "./types";

const listManagedOrgsSchema = z.object({}).strict();

type Args = z.infer<typeof listManagedOrgsSchema>;

export const listManagedOrgsModule: ToolModule<Args> = {
  name: "list_managed_orgs",
  argsSchema: listManagedOrgsSchema,
  async execute(_args, { ctx, sb, logContext }) {
    return safeToolQuery(logContext, () => listManagedOrgs(sb, ctx.enterpriseId!));
  },
};
