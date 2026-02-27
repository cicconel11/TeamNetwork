import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { validateJson, ValidationError, validationErrorResponse, baseSchemas, safeString } from "@/lib/security/validation";
import { batchGetMediaUrls } from "@/lib/media/urls";
import { decodeCursor } from "@/lib/pagination/cursor";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const albumItemsQuerySchema = z.object({
  orgId: baseSchemas.uuid,
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

const patchAlbumSchema = z.object({
  orgId: baseSchemas.uuid,
  name: safeString(200, 2).optional(),
  cover_media_id: baseSchemas.uuid.optional().nullable(),
});

type Params = { params: { albumId: string } };

/**
 * GET /api/media/albums/[albumId]?orgId=&cursor=&limit=
 * Paginated list of approved media items in this album.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { albumId } = params;

    const rateLimit = checkRateLimit(request, {
      feature: "media album items",
      limitPerIp: 60,
      limitPerUser: 45,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const parsed = albumItemsQuerySchema.safeParse({
      orgId: searchParams.get("orgId"),
      cursor: searchParams.get("cursor") || undefined,
      limit: searchParams.get("limit") || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
    }
    const { orgId, cursor, limit } = parsed.data;

    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";
    const serviceClient = createServiceClient();

    // Verify album belongs to org and is not deleted
    const { data: album, error: albumError } = await (serviceClient as any)
      .from("media_albums")
      .select("id, name, description, cover_media_id, item_count, created_by, created_at, updated_at, organization_id")
      .eq("id", albumId)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (albumError || !album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    // Fetch album items joined with media_items
    let query = serviceClient
      .from("media_album_items")
      .select(`
        media_item_id,
        sort_order,
        added_at,
        media_items!inner(
          id, title, description, media_type, storage_path, mime_type, thumbnail_url,
          external_url, tags, taken_at, created_at, uploaded_by, status,
          users!media_items_uploaded_by_users_fkey(name)
        )
      `)
      .eq("album_id", albumId)
      .is("media_items.deleted_at", null)
      .order("added_at", { ascending: false })
      .order("media_item_id", { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded) {
        return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
      }
      // cursor is based on added_at + media_item_id for album items
      query = query.or(
        `added_at.lt.${decoded.createdAt},and(added_at.eq.${decoded.createdAt},media_item_id.lt.${decoded.id})`,
      );
    }

    const { data: albumItems, error: itemsError } = await query;
    if (itemsError) {
      console.error("[media/albums/[albumId]] Items query failed:", itemsError);
      return NextResponse.json({ error: "Failed to fetch album items" }, { status: 500 });
    }

    // Flatten: extract media_items from join result
    const rawItems = (albumItems || []).map((row: Record<string, unknown>) => {
      const mi = row.media_items as Record<string, unknown>;
      return {
        ...mi,
        // Use added_at as the cursor field (rename to created_at for cursor compat)
        _cursor_at: row.added_at as string,
        _cursor_id: row.media_item_id as string,
      };
    });

    // Visibility filter: mirrors the main gallery /api/media logic.
    // Admins see all statuses; others see approved items + their own pending/rejected.
    const visibleItems = rawItems.filter((item: Record<string, unknown>) => {
      if (isAdmin) return true;
      if (item.status === "approved") return true;
      if (item.uploaded_by === user.id) return true;
      return false;
    });

    const hasMore = visibleItems.length > limit;
    const data = hasMore ? visibleItems.slice(0, limit) : visibleItems;
    const lastItem = data[data.length - 1];
    const nextCursor = hasMore && lastItem
      ? Buffer.from(JSON.stringify({ t: lastItem._cursor_at, i: lastItem._cursor_id })).toString("base64url")
      : null;

    // Clean up internal cursor fields
    const cleanData = data.map(({ _cursor_at: _a, _cursor_id: _i, ...rest }) => rest);

    // Generate signed URLs
    const storageItems = cleanData
      .filter((item: Record<string, unknown>) => item.storage_path)
      .map((item: Record<string, unknown>) => ({
        id: item.id as string,
        storage_path: item.storage_path as string,
        mime_type: (item.mime_type as string) || "application/octet-stream",
      }));

    const urlMap = storageItems.length > 0
      ? await batchGetMediaUrls(serviceClient, storageItems)
      : new Map();

    const enriched = cleanData.map((item: Record<string, unknown>) => {
      const urls = urlMap.get(item.id as string);
      return {
        ...item,
        url: urls?.url || item.external_url || null,
        thumbnail_url: urls?.thumbnailUrl || item.thumbnail_url || null,
      };
    });

    return NextResponse.json(
      { album, data: enriched, nextCursor, hasMore },
      { headers: rateLimit.headers },
    );
  } catch (error) {
    if (error instanceof ValidationError) return validationErrorResponse(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/media/albums/[albumId]
 * Update album name or cover. Auth: creator or admin.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { albumId } = params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await validateJson(request, patchAlbumSchema);
    const { orgId, name, cover_media_id } = body;

    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";
    const serviceClient = createServiceClient();

    const { data: album, error: fetchError } = await (serviceClient as any)
      .from("media_albums")
      .select("id, created_by, organization_id")
      .eq("id", albumId)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (fetchError || !album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    if (!isAdmin && album.created_by !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (cover_media_id !== undefined) updates.cover_media_id = cover_media_id;

    const { data: updated, error: updateError } = await (serviceClient as any)
      .from("media_albums")
      .update(updates)
      .eq("id", albumId)
      .select("id, name, description, cover_media_id, item_count, created_by, created_at, updated_at")
      .single();

    if (updateError) {
      console.error("[media/albums/[albumId]] Update failed:", updateError);
      return NextResponse.json({ error: "Failed to update album" }, { status: 500 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof ValidationError) return validationErrorResponse(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/media/albums/[albumId]?orgId=
 * Soft delete: sets deleted_at. Auth: creator or admin.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { albumId } = params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("orgId");
    if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });

    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";
    const serviceClient = createServiceClient();

    const { data: album, error: fetchError } = await (serviceClient as any)
      .from("media_albums")
      .select("id, created_by, organization_id")
      .eq("id", albumId)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (fetchError || !album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    if (!isAdmin && album.created_by !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error: deleteError } = await (serviceClient as any)
      .from("media_albums")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", albumId);

    if (deleteError) {
      console.error("[media/albums/[albumId]] Delete failed:", deleteError);
      return NextResponse.json({ error: "Failed to delete album" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) return validationErrorResponse(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
