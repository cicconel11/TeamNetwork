import { z } from "zod";
import { safeToolQuery } from "@/lib/ai/tools/shared";
import { listEnterpriseAuditEvents } from "@/lib/ai/tools/enterprise/audit-visibility";
import type { ToolModule } from "./types";

const listEnterpriseAuditEventsSchema = z
  .object({
    organization_id: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

type Args = z.infer<typeof listEnterpriseAuditEventsSchema>;

export const listEnterpriseAuditEventsModule: ToolModule<Args> = {
  name: "list_enterprise_audit_events",
  argsSchema: listEnterpriseAuditEventsSchema,
  async execute(args, { ctx, sb, logContext }) {
    return safeToolQuery(logContext, () =>
      listEnterpriseAuditEvents(sb, ctx.enterpriseId!, args),
    );
  },
};
