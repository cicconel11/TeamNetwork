import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { validateJson, ValidationError, validationErrorResponse, baseSchemas } from "@/lib/security/validation";
import { createAlbumSchema } from "@/lib/schemas/media";
import { batchGetMediaUrls } from "@/lib/media/urls";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const albumsListQuerySchema = z.object({
  orgId: baseSchemas.uuid,
  containsItemId: baseSchemas.uuid.optional(),
});

/**
 * GET /api/media/albums?orgId=&containsItemId=
 * List albums for an org. Optional containsItemId filters to albums containing a specific media item.
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimit = checkRateLimit(request, {
      feature: "media albums list",
      limitPerIp: 60,
      limitPerUser: 45,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const parsed = albumsListQuerySchema.safeParse({
      orgId: searchParams.get("orgId"),
      containsItemId: searchParams.get("containsItemId") || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
    }
    const { orgId, containsItemId } = parsed.data;

    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const serviceClient = createServiceClient();

    let query = (serviceClient as any)
      .from("media_albums")
      .select("id, name, description, cover_media_id, item_count, created_by, created_at, updated_at")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (containsItemId) {
      // Filter to albums containing this media item
      const { data: albumItems } = await serviceClient
        .from("media_album_items")
        .select("album_id")
        .eq("media_item_id", containsItemId);
      const albumIds = (albumItems || []).map((r: { album_id: string }) => r.album_id);
      if (albumIds.length === 0) {
        return NextResponse.json({ data: [] }, { headers: rateLimit.headers });
      }
      query = query.in("id", albumIds);
    }

    const { data: albums, error } = await query;
    if (error) {
      console.error("[media/albums] List failed:", error);
      return NextResponse.json({ error: "Failed to fetch albums" }, { status: 500 });
    }

    // Attach cover image URLs for albums that have a cover_media_id
    const coversToFetch = (albums || [])
      .filter((a: Record<string, unknown>) => a.cover_media_id)
      .map((a: Record<string, unknown>) => a.cover_media_id as string);

    let coverUrlMap = new Map<string, string>();
    if (coversToFetch.length > 0) {
      const { data: coverItems } = await serviceClient
        .from("media_items")
        .select("id, storage_path, mime_type")
        .in("id", coversToFetch)
        .is("deleted_at", null);

      if (coverItems && coverItems.length > 0) {
        const urlMap = await batchGetMediaUrls(
          serviceClient,
          coverItems
            .filter((ci) => ci.storage_path)
            .map((ci) => ({
              id: ci.id,
              storage_path: ci.storage_path as string,
              mime_type: (ci.mime_type as string) || "application/octet-stream",
            })),
        );
        for (const [id, urls] of urlMap) {
          if (urls.thumbnailUrl || urls.url) {
            coverUrlMap.set(id, urls.thumbnailUrl || urls.url || "");
          }
        }
      }
    }

    const enriched = (albums || []).map((a: Record<string, unknown>) => ({
      ...a,
      cover_url: a.cover_media_id ? (coverUrlMap.get(a.cover_media_id as string) || null) : null,
    }));

    return NextResponse.json({ data: enriched }, { headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) return validationErrorResponse(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const createAlbumBodySchema = createAlbumSchema.extend({
  orgId: baseSchemas.uuid,
});

/**
 * POST /api/media/albums
 * Create a new album. Auth: same upload permission check (media_upload_roles).
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimit = checkRateLimit(request, {
      feature: "media albums create",
      limitPerIp: 20,
      limitPerUser: 10,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await validateJson(request, createAlbumBodySchema);
    const { orgId, name, description } = body;

    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const serviceClient = createServiceClient();

    // Check upload roles (same permission as file upload)
    const { data: org } = await serviceClient
      .from("organizations")
      .select("media_upload_roles")
      .eq("id", orgId)
      .maybeSingle();

    const allowedRoles = (org as Record<string, unknown> | null)?.media_upload_roles as string[] || ["admin", "active_member"];
    if (!allowedRoles.includes(membership.role)) {
      return NextResponse.json({ error: "You do not have permission to create albums" }, { status: 403 });
    }

    const { data: album, error } = await (serviceClient as any)
      .from("media_albums")
      .insert({
        organization_id: orgId,
        name,
        description: description || null,
        created_by: user.id,
      })
      .select("id, name, description, cover_media_id, item_count, created_by, created_at, updated_at")
      .single();

    if (error) {
      console.error("[media/albums] Create failed:", error);
      return NextResponse.json({ error: "Failed to create album" }, { status: 500 });
    }

    return NextResponse.json({ ...album, cover_url: null }, { status: 201, headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) return validationErrorResponse(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
