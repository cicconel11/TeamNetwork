import { z } from "zod";
import { safeToolQuery } from "@/lib/ai/tools/shared";
import type { ToolModule } from "./types";

export const DONATION_ANALYTICS_DIMENSIONS = [
  "trend",
  "totals",
  "top_purposes",
  "status_mix",
  "all",
] as const;
export type DonationAnalyticsDimension = (typeof DONATION_ANALYTICS_DIMENSIONS)[number];

const getDonationAnalyticsSchema = z
  .object({
    window_days: z.number().int().min(7).max(3650).optional(),
    bucket: z.enum(["day", "week", "month"]).optional(),
    top_purposes_limit: z.number().int().min(1).max(10).optional(),
    dimension: z.enum(DONATION_ANALYTICS_DIMENSIONS).optional(),
  })
  .strict();

type Args = z.infer<typeof getDonationAnalyticsSchema>;

function defaultDonationAnalyticsBucket(windowDays: number): "day" | "week" | "month" {
  if (windowDays <= 31) return "day";
  if (windowDays <= 180) return "week";
  return "month";
}

function narrowByDimension(
  payload: unknown,
  dimension: DonationAnalyticsDimension | undefined
): unknown {
  if (!payload || typeof payload !== "object") return payload;
  if (!dimension || dimension === "all") return payload;

  const source = payload as Record<string, unknown>;
  const base: Record<string, unknown> = {};
  if (typeof source.window_days === "number") base.window_days = source.window_days;
  if (typeof source.bucket === "string") base.bucket = source.bucket;

  if (dimension === "trend") {
    if (Array.isArray(source.trend)) base.trend = source.trend;
    return base;
  }
  if (dimension === "top_purposes") {
    if (Array.isArray(source.top_purposes)) base.top_purposes = source.top_purposes;
    return base;
  }
  if (dimension === "totals") {
    const totals = source.totals as Record<string, unknown> | undefined;
    if (totals && typeof totals === "object") {
      const rest: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(totals)) {
        if (key === "status_counts") continue;
        rest[key] = value;
      }
      base.totals = rest;
    }
    return base;
  }
  if (dimension === "status_mix") {
    const totals = source.totals as Record<string, unknown> | undefined;
    if (totals && typeof totals === "object" && totals.status_counts) {
      base.totals = { status_counts: totals.status_counts };
    }
    return base;
  }
  return payload;
}

export const getDonationAnalyticsModule: ToolModule<Args> = {
  name: "get_donation_analytics",
  argsSchema: getDonationAnalyticsSchema,
  async execute(args, { ctx, sb, logContext }) {
    const windowDays = args.window_days ?? 90;
    const bucket = args.bucket ?? defaultDonationAnalyticsBucket(windowDays);
    const topPurposesLimit = args.top_purposes_limit ?? 5;
    const dimension = args.dimension;

    return safeToolQuery(logContext, async () => {
      const { data, error } = await sb.rpc("get_donation_analytics", {
        p_org_id: ctx.orgId,
        p_window_days: windowDays,
        p_bucket: bucket,
        p_top_purposes_limit: topPurposesLimit,
      });

      if (error) {
        return { data, error };
      }

      return { data: narrowByDimension(data, dimension), error: null };
    });
  },
};
