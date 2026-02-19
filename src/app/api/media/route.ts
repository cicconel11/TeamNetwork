import { randomUUID } from "crypto";
import { extname } from "path";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { validateJson, ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import { galleryUploadIntentSchema, mediaListQuerySchema, GALLERY_ALLOWED_MIME_TYPES } from "@/lib/schemas/media";
import { decodeCursor, applyCursorFilter, buildCursorResponse } from "@/lib/pagination/cursor";
import { batchGetMediaUrls } from "@/lib/media/urls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/media — List gallery items with cursor pagination
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimit = checkRateLimit(request, {
      feature: "media list",
      limitPerIp: 60,
      limitPerUser: 45,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse and validate query params
    const { searchParams } = new URL(request.url);
    const parsed = mediaListQuerySchema.safeParse({
      orgId: searchParams.get("orgId"),
      cursor: searchParams.get("cursor") || undefined,
      limit: searchParams.get("limit") || undefined,
      tag: searchParams.get("tag") || undefined,
      year: searchParams.get("year") || undefined,
      mediaType: searchParams.get("mediaType") || undefined,
      status: searchParams.get("status") || undefined,
      uploadedBy: searchParams.get("uploadedBy") || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { orgId, cursor, limit, tag, year, mediaType, status, uploadedBy } = parsed.data;

    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";
    const serviceClient = createServiceClient();

    // Build query — fetch limit+1 for cursor pagination
    let query = serviceClient
      .from("media_items")
      .select("*, users!media_items_uploaded_by_users_fkey(name)")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    // Status filter: non-admins can only see approved + own items
    if (isAdmin && status) {
      query = query.eq("status", status);
    } else if (!isAdmin) {
      if (uploadedBy === "self") {
        // User viewing their own uploads — show all statuses
        query = query.eq("uploaded_by", user.id);
      } else {
        // Non-admin viewing gallery — approved only
        query = query.eq("status", "approved");
      }
    }

    // Additional filters
    if (mediaType) {
      query = query.eq("media_type", mediaType);
    }
    if (tag) {
      query = query.contains("tags", [tag.toLowerCase()]);
    }
    if (year) {
      query = query
        .gte("taken_at", `${year}-01-01T00:00:00Z`)
        .lt("taken_at", `${year + 1}-01-01T00:00:00Z`);
    }
    if (uploadedBy && uploadedBy !== "self") {
      query = query.eq("uploaded_by", uploadedBy);
    }

    // Apply cursor
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded) {
        return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
      }
      query = applyCursorFilter(query, decoded);
    }

    const { data: items, error } = await query;
    if (error) {
      console.error("[media/gallery] List query failed:", error);
      return NextResponse.json({ error: "Failed to fetch media" }, { status: 500 });
    }

    const { data, nextCursor, hasMore } = buildCursorResponse(items || [], limit);

    // Generate signed URLs for items with storage paths
    const storageItems = data
      .filter((item: Record<string, unknown>) => item.storage_path)
      .map((item: Record<string, unknown>) => ({
        id: item.id as string,
        storage_path: item.storage_path as string,
        mime_type: (item.mime_type as string) || "application/octet-stream",
      }));

    const urlMap = storageItems.length > 0
      ? await batchGetMediaUrls(serviceClient, storageItems)
      : new Map();

    // Attach URLs to items
    const enrichedData = data.map((item: Record<string, unknown>) => {
      const urls = urlMap.get(item.id as string);
      return {
        ...item,
        url: urls?.url || item.external_url || null,
        thumbnail_url: urls?.thumbnailUrl || item.thumbnail_url || null,
      };
    });

    return NextResponse.json(
      { data: enrichedData, nextCursor, hasMore },
      { headers: rateLimit.headers },
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/media — Upload intent (create media_items row + signed upload URL)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      feature: "media upload",
      limitPerIp: 20,
      limitPerUser: 10,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const body = await validateJson(request, galleryUploadIntentSchema);
    const { orgId, fileName, mimeType, fileSizeBytes, title, description, tags, takenAt } = body;

    // Check org membership and upload role
    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    // Fetch configurable media upload roles from the org
    const serviceClient = createServiceClient();
    const { data: org } = await serviceClient
      .from("organizations")
      .select("media_upload_roles")
      .eq("id", orgId)
      .maybeSingle();

    const allowedRoles = (org as Record<string, unknown> | null)?.media_upload_roles as string[] || ["admin", "active_member"];
    if (!allowedRoles.includes(membership.role)) {
      return NextResponse.json(
        { error: "You do not have permission to upload media" },
        { status: 403 },
      );
    }

    // Check org read-only mode
    const { isReadOnly } = await checkOrgReadOnly(orgId);
    if (isReadOnly) {
      return NextResponse.json(readOnlyResponse(), { status: 403 });
    }

    // Validate MIME type is in allowlist
    if (!GALLERY_ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }

    // Determine media type from MIME
    const mediaType = mimeType.startsWith("image/") ? "image" : "video";

    // Generate storage path
    const ext = extname(fileName).replace(".", "").toLowerCase() || mimeType.split("/")[1] || "bin";
    const storagePath = `${orgId}/${mediaType}/${Date.now()}-${randomUUID()}.${ext}`;

    // Start in "uploading" state — finalize endpoint transitions to final status
    const initialStatus = "uploading";

    const { data: mediaItem, error: insertError } = await serviceClient
      .from("media_items")
      .insert({
        organization_id: orgId,
        uploaded_by: user.id,
        storage_path: storagePath,
        file_name: fileName,
        mime_type: mimeType,
        file_size_bytes: fileSizeBytes,
        media_type: mediaType,
        title: title || fileName,
        description: description || null,
        tags: tags || [],
        taken_at: takenAt || null,
        status: initialStatus,
      })
      .select("id")
      .single();

    if (insertError) {
      return NextResponse.json({ error: "Failed to create media item" }, { status: 500 });
    }

    // Generate signed upload URL
    const { data: signedData, error: signedError } = await serviceClient.storage
      .from("org-media")
      .createSignedUploadUrl(storagePath);

    if (signedError || !signedData) {
      // Clean up the DB row if we can't get a signed URL
      await serviceClient.from("media_items").delete().eq("id", mediaItem.id);
      return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 });
    }

    console.log("[media/gallery] Upload intent created", { orgId, mediaId: mediaItem.id, mimeType, fileSizeBytes });

    return NextResponse.json(
      {
        mediaId: mediaItem.id,
        signedUrl: signedData.signedUrl,
        token: signedData.token,
        path: storagePath,
      },
      { status: 201, headers: rateLimit.headers },
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
