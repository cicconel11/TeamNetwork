import { z } from "zod";
import { safeToolQuery } from "@/lib/ai/tools/shared";
import { searchNavigationTargets } from "@/lib/ai/navigation-targets";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { ToolModule } from "./types";

const findNavigationTargetsSchema = z
  .object({
    query: z.string().trim().min(1),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .strict();

type Args = z.infer<typeof findNavigationTargetsSchema>;

export const findNavigationTargetsModule: ToolModule<Args> = {
  name: "find_navigation_targets",
  argsSchema: findNavigationTargetsSchema,
  async execute(args, { ctx, sb, logContext }) {
    return safeToolQuery(logContext, async () => {
      const [orgResult, subscriptionResult] = await Promise.all([
        sb
          .from("organizations")
          .select("slug, nav_config")
          .eq("id", ctx.orgId)
          .maybeSingle(),
        sb.rpc("get_subscription_status", { p_org_id: ctx.orgId }),
      ]);

      const { data: org, error } = orgResult;
      if (error || !org?.slug) {
        return { data: null, error: error ?? new Error("Organization not found") };
      }

      const { data: subscriptionRows, error: subscriptionError } = subscriptionResult;

      const subscription = subscriptionError
        ? null
        : Array.isArray(subscriptionRows)
          ? subscriptionRows[0]
          : null;
      const hasAlumniAccess =
        subscription?.status === "enterprise_managed" ||
        (subscription?.alumni_bucket != null && subscription.alumni_bucket !== "none");
      const hasParentsAccess =
        subscription?.status === "enterprise_managed" ||
        (subscription?.parents_bucket != null && subscription.parents_bucket !== "none");

      return {
        data: searchNavigationTargets({
          query: args.query,
          orgSlug: org.slug,
          navConfig:
            org.nav_config && typeof org.nav_config === "object" && !Array.isArray(org.nav_config)
              ? (org.nav_config as NavConfig)
              : null,
          role: ctx.authorization.kind === "preverified_role" ? ctx.authorization.role : "admin",
          hasAlumniAccess,
          hasParentsAccess,
          limit: args.limit,
        }),
        error: null,
      };
    });
  },
};
