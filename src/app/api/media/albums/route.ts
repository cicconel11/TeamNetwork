/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { validateJson, ValidationError, validationErrorResponse, baseSchemas } from "@/lib/security/validation";
import { createAlbumSchema } from "@/lib/schemas/media";
import {
  shouldListMediaAlbum,
  withMediaAlbumsDraftColumnFallback,
} from "@/lib/media/gallery-upload-server";
import { batchGetGridPreviewUrls, MEDIA_LIST_CACHE_HEADERS } from "@/lib/media/urls";
import {
  getAlbumFallbackCoverSelections,
  shouldExposeAlbumCover,
} from "@/lib/media/albums";
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
    const selectWithDraftColumn = "id, name, description, cover_media_id, item_count, sort_order, created_by, created_at, updated_at, is_upload_draft";
    const selectWithoutDraftColumn = "id, name, description, cover_media_id, item_count, sort_order, created_by, created_at, updated_at";

    const buildAlbumsQuery = (includeDraftColumn: boolean) => {
      return (serviceClient as any)
        .from("media_albums")
        .select(includeDraftColumn ? selectWithDraftColumn : selectWithoutDraftColumn)
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
    };

    if (containsItemId) {
      // Filter to albums containing this media item
      const { data: albumItems } = await serviceClient
        .from("media_album_items")
        .select("album_id")
        .eq("media_item_id", containsItemId);
      const albumIds = (albumItems || []).map((r: { album_id: string }) => r.album_id);
      if (albumIds.length === 0) {
        return NextResponse.json(
          { data: [] },
          { headers: { ...rateLimit.headers, ...MEDIA_LIST_CACHE_HEADERS } },
        );
      }
      // Reuse the same fallback path for both select shapes.
      const { data: albums, error, usedDraftColumn } = await withMediaAlbumsDraftColumnFallback({
        withDraftColumn: async () => buildAlbumsQuery(true).in("id", albumIds),
        withoutDraftColumn: async () => buildAlbumsQuery(false).in("id", albumIds),
      });

      if (error) {
        console.error("[media/albums] List failed:", error);
        return NextResponse.json({ error: "Failed to fetch albums" }, { status: 500 });
      }

      const albumRows = normalizeAlbumRows(albums);
      const visibleAlbums = usedDraftColumn
        ? albumRows.filter((album) => shouldListMediaAlbum({
          is_upload_draft: album.is_upload_draft as boolean | null | undefined,
          item_count: album.item_count as number | null | undefined,
        }))
        : albumRows;

      return enrichAlbumsWithCovers(serviceClient, visibleAlbums, {
        ...rateLimit.headers,
        ...MEDIA_LIST_CACHE_HEADERS,
      });
    }

    const { data: albums, error, usedDraftColumn } = await withMediaAlbumsDraftColumnFallback({
      withDraftColumn: async () => buildAlbumsQuery(true),
      withoutDraftColumn: async () => buildAlbumsQuery(false),
    });

    if (error) {
      console.error("[media/albums] List failed:", error);
      return NextResponse.json({ error: "Failed to fetch albums" }, { status: 500 });
    }

    const albumRows = normalizeAlbumRows(albums);
    const visibleAlbums = usedDraftColumn
      ? albumRows.filter((album) => shouldListMediaAlbum({
        is_upload_draft: album.is_upload_draft as boolean | null | undefined,
        item_count: album.item_count as number | null | undefined,
      }))
      : albumRows;

    return enrichAlbumsWithCovers(serviceClient, visibleAlbums, {
      ...rateLimit.headers,
      ...MEDIA_LIST_CACHE_HEADERS,
    });
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
    const { orgId, name, description, isUploadDraft } = body;

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

    const { error: shiftError } = await (serviceClient as any).rpc("shift_media_album_sort_orders", {
      p_org_id: orgId,
    });
    if (shiftError) {
      console.error("[media/albums] shift sort orders failed:", shiftError);
      return NextResponse.json({ error: "Failed to create album" }, { status: 500 });
    }

    const selectWithDraftColumn = "id, name, description, cover_media_id, item_count, sort_order, created_by, created_at, updated_at, is_upload_draft";
    const selectWithoutDraftColumn = "id, name, description, cover_media_id, item_count, sort_order, created_by, created_at, updated_at";
    const baseInsert = {
      organization_id: orgId,
      name,
      description: description || null,
      created_by: user.id,
      sort_order: 0,
    };

    const { data: album, error } = await withMediaAlbumsDraftColumnFallback({
      withDraftColumn: async () => await (serviceClient as any)
        .from("media_albums")
        .insert({
          ...baseInsert,
          is_upload_draft: isUploadDraft ?? false,
        })
        .select(selectWithDraftColumn)
        .single(),
      withoutDraftColumn: async () => await (serviceClient as any)
        .from("media_albums")
        .insert(baseInsert)
        .select(selectWithoutDraftColumn)
        .single(),
    });

    if (error) {
      console.error("[media/albums] Create failed:", error);
      return NextResponse.json({ error: "Failed to create album" }, { status: 500 });
    }

    const albumRecord = normalizeSingleAlbumRow(album);
    const responseAlbum: Record<string, unknown> = { ...albumRecord };
    delete responseAlbum.is_upload_draft;
    return NextResponse.json({ ...responseAlbum, cover_url: null }, { status: 201, headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) return validationErrorResponse(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function normalizeAlbumRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object");
}

function normalizeSingleAlbumRow(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}

async function enrichAlbumsWithCovers(
  serviceClient: ReturnType<typeof createServiceClient>,
  albums: Record<string, unknown>[],
  headers: HeadersInit,
) {
  const explicitCoverIds = Array.from(new Set(albums
    .filter((album) => album.cover_media_id)
    .map((album) => album.cover_media_id as string)));

  const explicitCoverUrlMap = new Map<string, string>();
  if (explicitCoverIds.length > 0) {
    const { data: coverItems } = await serviceClient
      .from("media_items")
      .select("id, storage_path, preview_storage_path, mime_type, media_type, status")
      .in("id", explicitCoverIds)
      .is("deleted_at", null);

    if (coverItems && coverItems.length > 0) {
      const urlMap = await batchGetGridPreviewUrls(
        serviceClient,
        coverItems
          .filter((coverItem) => shouldExposeAlbumCover(coverItem))
          .filter((coverItem) => coverItem.storage_path)
          .map((coverItem) => ({
            id: coverItem.id,
            storage_path: coverItem.storage_path as string,
            preview_storage_path: (coverItem.preview_storage_path as string | null) ?? null,
            mime_type: (coverItem.mime_type as string) || "application/octet-stream",
            media_type: coverItem.media_type as "image" | "video",
          })),
      );
      for (const [id, urls] of urlMap) {
        if (urls.thumbnailUrl) {
          explicitCoverUrlMap.set(id, urls.thumbnailUrl);
        }
      }
    }
  }

  const fallbackAlbumIds = albums
    .filter((album) => {
      const coverMediaId = album.cover_media_id as string | null | undefined;
      return !coverMediaId || !explicitCoverUrlMap.has(coverMediaId);
    })
    .map((album) => album.id as string);

  const fallbackCoverUrlMap = new Map<string, string>();
  if (fallbackAlbumIds.length > 0) {
    const { data: fallbackRows } = await serviceClient
      .from("media_album_items")
      .select(`
        album_id,
        media_item_id,
        added_at,
        media_items!inner(
          storage_path,
          preview_storage_path,
          mime_type,
          media_type,
          status
        )
      `)
      .in("album_id", fallbackAlbumIds)
      .is("media_items.deleted_at", null)
      .order("album_id", { ascending: true })
      .order("added_at", { ascending: true })
      .order("media_item_id", { ascending: true });

    const fallbackSelections = getAlbumFallbackCoverSelections(
      (fallbackRows ?? []).map((row) => {
        const media = row.media_items as Record<string, unknown> | null;
        return {
          album_id: row.album_id as string,
          media_item_id: row.media_item_id as string,
          media_type: (media?.media_type as string | null) ?? null,
          status: (media?.status as string | null) ?? null,
          media_items: media
            ? {
              storage_path: (media.storage_path as string | null) ?? null,
              preview_storage_path: (media.preview_storage_path as string | null) ?? null,
              mime_type: (media.mime_type as string | null) ?? null,
            }
            : null,
        };
      }),
    );

    const fallbackUrlLookup = fallbackSelections.length > 0
      ? await batchGetGridPreviewUrls(serviceClient, fallbackSelections.map((selection) => ({
        id: selection.mediaId,
        storage_path: selection.storage_path,
        preview_storage_path: selection.preview_storage_path,
        mime_type: selection.mime_type,
        media_type: selection.media_type,
      })))
      : new Map();

    for (const selection of fallbackSelections) {
      const url = fallbackUrlLookup.get(selection.mediaId)?.thumbnailUrl;
      if (url) {
        fallbackCoverUrlMap.set(selection.albumId, url);
      }
    }
  }

  const enriched = albums.map((album) => {
    const coverMediaId = album.cover_media_id as string | null | undefined;
    const explicitCoverUrl = coverMediaId ? (explicitCoverUrlMap.get(coverMediaId) ?? null) : null;
    const responseAlbum: Record<string, unknown> = {
      ...album,
      cover_url: explicitCoverUrl ?? (fallbackCoverUrlMap.get(album.id as string) ?? null),
    };
    delete responseAlbum.is_upload_draft;
    return responseAlbum;
  });

  return NextResponse.json({ data: enriched }, { headers });
}
