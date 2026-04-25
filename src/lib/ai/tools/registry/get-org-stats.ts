import { z } from "zod";
import { safeToolCount, safeToolQuery } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import type { ToolModule } from "./types";

const getOrgStatsSchema = z.object({}).strict();

type Args = z.infer<typeof getOrgStatsSchema>;

export const getOrgStatsModule: ToolModule<Args> = {
  name: "get_org_stats",
  argsSchema: getOrgStatsSchema,
  async execute(_args, { ctx, sb, logContext }) {
    const [members, alumni, parents, upcomingEvents, donations] = await Promise.all([
      safeToolCount(logContext, () =>
        sb
          .from("members")
          .select("*", { count: "estimated", head: true })
          .eq("organization_id", ctx.orgId)
          .is("deleted_at", null)
          .eq("status", "active")
      ),
      safeToolCount(logContext, () =>
        sb
          .from("alumni")
          .select("*", { count: "estimated", head: true })
          .eq("organization_id", ctx.orgId)
          .is("deleted_at", null)
      ),
      safeToolCount(logContext, () =>
        sb
          .from("parents")
          .select("*", { count: "estimated", head: true })
          .eq("organization_id", ctx.orgId)
          .is("deleted_at", null)
      ),
      safeToolCount(logContext, () =>
        sb
          .from("events")
          .select("*", { count: "estimated", head: true })
          .eq("organization_id", ctx.orgId)
          .is("deleted_at", null)
          .gte("start_date", new Date().toISOString())
      ),
      safeToolQuery(logContext, () =>
        sb
          .from("organization_donation_stats")
          .select("total_amount_cents, donation_count, last_donation_at")
          .eq("organization_id", ctx.orgId)
          .maybeSingle()
      ),
    ]);

    if (!members.ok || !alumni.ok || !parents.ok || !upcomingEvents.ok || donations.kind !== "ok") {
      return toolError("Query failed");
    }

    return {
      kind: "ok",
      data: {
        active_members: members.count,
        alumni: alumni.count,
        parents: parents.count,
        upcoming_events: upcomingEvents.count,
        donations: donations.data,
      },
    };
  },
};
