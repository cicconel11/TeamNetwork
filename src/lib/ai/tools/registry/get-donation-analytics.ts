import { z } from "zod";
import { safeToolQuery } from "@/lib/ai/tools/shared";
import type { ToolModule } from "./types";

const getDonationAnalyticsSchema = z
  .object({
    window_days: z.number().int().min(7).max(3650).optional(),
    bucket: z.enum(["day", "week", "month"]).optional(),
    top_purposes_limit: z.number().int().min(1).max(10).optional(),
  })
  .strict();

type Args = z.infer<typeof getDonationAnalyticsSchema>;

function defaultDonationAnalyticsBucket(windowDays: number): "day" | "week" | "month" {
  if (windowDays <= 31) return "day";
  if (windowDays <= 180) return "week";
  return "month";
}

export const getDonationAnalyticsModule: ToolModule<Args> = {
  name: "get_donation_analytics",
  argsSchema: getDonationAnalyticsSchema,
  async execute(args, { ctx, sb, logContext }) {
    const windowDays = args.window_days ?? 90;
    const bucket = args.bucket ?? defaultDonationAnalyticsBucket(windowDays);
    const topPurposesLimit = args.top_purposes_limit ?? 5;

    return safeToolQuery(logContext, async () => {
      const { data, error } = await sb.rpc("get_donation_analytics", {
        p_org_id: ctx.orgId,
        p_window_days: windowDays,
        p_bucket: bucket,
        p_top_purposes_limit: topPurposesLimit,
      });

      return { data, error };
    });
  },
};
