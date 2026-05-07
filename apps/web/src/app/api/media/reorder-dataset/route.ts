import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { mediaListQuerySchema } from "@/lib/schemas/media";
import {
  decodeGalleryCursor,
  applyGalleryCursorFilter,
  buildGalleryCursorResponse,
} from "@/lib/pagination/cursor";
import { batchGetGridPreviewUrls, MEDIA_CACHE_HEADERS } from "@/lib/media/urls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/media/reorder-dataset
 * Lightweight gallery rows + thumbnail-only signed URLs for admin reorder mode.
 * Ignores tag/year/mediaType/status filters so the client always receives the full-org
 * sequence required by PATCH /api/media/reorder.
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimit = checkRateLimit(request, {
      feature: "media reorder dataset",
      limitPerIp: 30,
      limitPerUser: 25,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsed = mediaListQuerySchema.safeParse({
      orgId: searchParams.get("orgId"),
      cursor: searchParams.get("cursor") || undefined,
      limit: searchParams.get("limit") || undefined,
      tag: undefined,
      year: undefined,
      mediaType: undefined,
      status: undefined,
      uploadedBy: undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { orgId, cursor, limit } = parsed.data;

    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    if (membership.role !== "admin") {
      return NextResponse.json(
        { error: "Only organization admins can load the reorder dataset" },
        { status: 403 },
      );
    }

    const serviceClient = createServiceClient();

    let query = serviceClient
      .from("media_items")
      .select("*, users!media_items_uploaded_by_users_fkey(name)")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("gallery_sort_order", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit + 1);

    if (cursor) {
      const decoded = decodeGalleryCursor(cursor);
      if (!decoded) {
        return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
      }
      query = applyGalleryCursorFilter(query, decoded);
    }

    const { data: items, error } = await query;
    if (error) {
      console.error("[media/reorder-dataset] List query failed:", error);
      return NextResponse.json({ error: "Failed to fetch media" }, { status: 500 });
    }

    const { data, nextCursor, hasMore } = buildGalleryCursorResponse(
      (items || []) as { gallery_sort_order: number; id: string; created_at: string }[],
      limit,
    );

    const storageItems = data
      .filter((item: Record<string, unknown>) => item.storage_path)
      .map((item: Record<string, unknown>) => ({
        id: item.id as string,
        storage_path: item.storage_path as string,
        preview_storage_path: (item.preview_storage_path as string | null) ?? null,
        mime_type: (item.mime_type as string) || "application/octet-stream",
        media_type: item.media_type as "image" | "video",
      }));

    const urlMap = storageItems.length > 0
      ? await batchGetGridPreviewUrls(serviceClient, storageItems)
      : new Map();

    const enrichedData = data.map((item: Record<string, unknown>) => {
      const urls = urlMap.get(item.id as string);
      const hasStorage = Boolean(item.storage_path);
      return {
        ...item,
        url: hasStorage ? null : ((item.external_url as string | null) ?? null),
        thumbnail_url: urls?.thumbnailUrl ?? (item.thumbnail_url as string | null) ?? null,
      };
    });

    return NextResponse.json(
      { data: enrichedData, nextCursor, hasMore },
      { headers: { ...rateLimit.headers, ...MEDIA_CACHE_HEADERS } },
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
