import { z } from "zod";
import { safeToolCount, safeToolQuery } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import type { ToolModule } from "./types";

export const ORG_STATS_SCOPES = [
  "members",
  "alumni",
  "parents",
  "events",
  "donations",
  "all",
] as const;

export type OrgStatsScope = (typeof ORG_STATS_SCOPES)[number];

const getOrgStatsSchema = z
  .object({
    scope: z.enum(ORG_STATS_SCOPES).optional(),
  })
  .strict();

type Args = z.infer<typeof getOrgStatsSchema>;

function wantSlice(scope: OrgStatsScope | undefined, slice: Exclude<OrgStatsScope, "all">): boolean {
  if (!scope || scope === "all") return true;
  return scope === slice;
}

export const getOrgStatsModule: ToolModule<Args> = {
  name: "get_org_stats",
  argsSchema: getOrgStatsSchema,
  async execute(args, { ctx, sb, logContext }) {
    const scope = args.scope;

    const membersPromise = wantSlice(scope, "members")
      ? safeToolCount(logContext, () =>
          sb
            .from("members")
            .select("*", { count: "estimated", head: true })
            .eq("organization_id", ctx.orgId)
            .is("deleted_at", null)
            .eq("status", "active")
        )
      : null;

    const alumniPromise = wantSlice(scope, "alumni")
      ? safeToolCount(logContext, () =>
          sb
            .from("alumni")
            .select("*", { count: "estimated", head: true })
            .eq("organization_id", ctx.orgId)
            .is("deleted_at", null)
        )
      : null;

    const parentsPromise = wantSlice(scope, "parents")
      ? safeToolCount(logContext, () =>
          sb
            .from("parents")
            .select("*", { count: "estimated", head: true })
            .eq("organization_id", ctx.orgId)
            .is("deleted_at", null)
        )
      : null;

    const eventsPromise = wantSlice(scope, "events")
      ? safeToolCount(logContext, () =>
          sb
            .from("events")
            .select("*", { count: "estimated", head: true })
            .eq("organization_id", ctx.orgId)
            .is("deleted_at", null)
            .gte("start_date", new Date().toISOString())
        )
      : null;

    const donationsPromise = wantSlice(scope, "donations")
      ? safeToolQuery(logContext, () =>
          sb
            .from("organization_donation_stats")
            .select("total_amount_cents, donation_count, last_donation_at")
            .eq("organization_id", ctx.orgId)
            .maybeSingle()
        )
      : null;

    const [members, alumni, parents, upcomingEvents, donations] = await Promise.all([
      membersPromise,
      alumniPromise,
      parentsPromise,
      eventsPromise,
      donationsPromise,
    ]);

    if (members && !members.ok) return toolError("Query failed");
    if (alumni && !alumni.ok) return toolError("Query failed");
    if (parents && !parents.ok) return toolError("Query failed");
    if (upcomingEvents && !upcomingEvents.ok) return toolError("Query failed");
    if (donations && donations.kind !== "ok") return toolError("Query failed");

    const data: Record<string, unknown> = {};
    if (members) data.active_members = members.count;
    if (alumni) data.alumni = alumni.count;
    if (parents) data.parents = parents.count;
    if (upcomingEvents) data.upcoming_events = upcomingEvents.count;
    if (donations) data.donations = donations.data;

    return { kind: "ok", data };
  },
};
