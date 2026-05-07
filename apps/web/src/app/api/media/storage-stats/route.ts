/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { MEDIA_LIST_CACHE_HEADERS } from "@/lib/media/urls";
import { getStorageUsageSnapshot } from "@/lib/media/storage-quota";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z.object({ orgId: baseSchemas.uuid });

/**
 * GET /api/media/storage-stats?orgId=
 *
 * Returns app-layer media storage stats using the same accounting as upload
 * enforcement so the UI bar and the quota guard never drift.
 */
export async function GET(request: NextRequest) {
  const rateLimit = checkRateLimit(request, {
    feature: "media storage stats",
    limitPerIp: 30,
    limitPerUser: 20,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ orgId: searchParams.get("orgId") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }

  const membership = await getOrgMembership(supabase, user.id, parsed.data.orgId);
  if (!membership || membership.role !== "admin") {
    return NextResponse.json(
      { allowed: false, error: "Only admins can view storage stats" },
      { headers: { ...rateLimit.headers, ...MEDIA_LIST_CACHE_HEADERS } },
    );
  }

  const usage = await getStorageUsageSnapshot(createServiceClient(), parsed.data.orgId);
  if (!usage.ok) {
    return NextResponse.json({ error: "Failed to fetch storage stats" }, { status: 500 });
  }

  const { snapshot } = usage;
  const usagePercent =
    snapshot.quotaBytes && snapshot.quotaBytes > 0
      ? Math.round((snapshot.usedBytes / snapshot.quotaBytes) * 1000) / 10
      : 0;

  return NextResponse.json({
    allowed: true,
    total_bytes: snapshot.usedBytes,
    media_items_count: snapshot.mediaItemsCount,
    media_items_bytes: snapshot.mediaItemsBytes,
    media_uploads_count: snapshot.mediaUploadsCount,
    media_uploads_bytes: snapshot.mediaUploadsBytes,
    quota_bytes: snapshot.quotaBytes,
    usage_percent: usagePercent,
    over_quota: snapshot.quotaBytes === null ? false : snapshot.usedBytes > snapshot.quotaBytes,
  }, {
    headers: { ...rateLimit.headers, ...MEDIA_LIST_CACHE_HEADERS },
  });
}
