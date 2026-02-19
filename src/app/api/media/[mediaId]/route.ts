import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import {
  baseSchemas,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import { galleryUpdateMediaSchema, moderateMediaSchema } from "@/lib/schemas/media";
import { getMediaUrls } from "@/lib/media/urls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ mediaId: string }>;
}

/**
 * GET /api/media/[mediaId] — Get media item detail with signed URLs
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { mediaId } = await params;
    const idParsed = baseSchemas.uuid.safeParse(mediaId);
    if (!idParsed.success) {
      return NextResponse.json({ error: "Invalid media ID" }, { status: 400 });
    }

    const rateLimit = checkRateLimit(request, {
      feature: "media detail",
      limitPerIp: 120,
      limitPerUser: 90,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createServiceClient();
    const { data: item, error } = await serviceClient
      .from("media_items")
      .select("*, users!media_items_uploaded_by_users_fkey(name)")
      .eq("id", mediaId)
      .is("deleted_at", null)
      .single();

    if (error || !item) {
      return NextResponse.json({ error: "Media item not found" }, { status: 404 });
    }

    // Check org membership
    const membership = await getOrgMembership(supabase, user.id, item.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";
    const isUploader = item.uploaded_by === user.id;

    // Visibility rules:
    // - approved: any org member
    // - pending: uploader or admin
    // - rejected: admin only
    if (item.status === "rejected" && !isAdmin) {
      return NextResponse.json({ error: "Media item not found" }, { status: 404 });
    }
    if (item.status === "pending" && !isUploader && !isAdmin) {
      return NextResponse.json({ error: "Media item not found" }, { status: 404 });
    }

    // Generate signed URLs
    let url: string | null = null;
    let thumbnailUrl: string | null = null;

    if (item.storage_path && item.mime_type) {
      const urls = await getMediaUrls(serviceClient, item.storage_path, item.mime_type);
      url = urls.url;
      thumbnailUrl = urls.thumbnailUrl;
    }

    return NextResponse.json(
      {
        ...item,
        url: url || item.external_url || null,
        thumbnail_url: thumbnailUrl || item.thumbnail_url || null,
      },
      { headers: rateLimit.headers },
    );
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/media/[mediaId] — Update media metadata
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { mediaId } = await params;
    const idParsed = baseSchemas.uuid.safeParse(mediaId);
    if (!idParsed.success) {
      return NextResponse.json({ error: "Invalid media ID" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      feature: "media update",
      limitPerIp: 30,
      limitPerUser: 15,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const body = await validateJson(request, galleryUpdateMediaSchema);

    const serviceClient = createServiceClient();
    const { data: item, error: fetchError } = await serviceClient
      .from("media_items")
      .select("id, organization_id, uploaded_by, status")
      .eq("id", mediaId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !item) {
      return NextResponse.json({ error: "Media item not found" }, { status: 404 });
    }

    // Check org membership
    const membership = await getOrgMembership(supabase, user.id, item.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";
    const isUploader = item.uploaded_by === user.id;

    // Only uploader (while pending) or admin can update metadata
    if (!isAdmin && !(isUploader && item.status === "pending")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check org read-only mode
    const { isReadOnly } = await checkOrgReadOnly(item.organization_id);
    if (isReadOnly) {
      return NextResponse.json(readOnlyResponse(), { status: 403 });
    }

    // Build update payload
    const updatePayload: Record<string, unknown> = {};
    if (body.title !== undefined) updatePayload.title = body.title;
    if (body.description !== undefined) updatePayload.description = body.description || null;
    if (body.tags !== undefined) updatePayload.tags = body.tags;
    if (body.takenAt !== undefined) updatePayload.taken_at = body.takenAt;

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data: updated, error: updateError } = await serviceClient
      .from("media_items")
      .update(updatePayload)
      .eq("id", mediaId)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json({ error: "Failed to update media item" }, { status: 500 });
    }

    return NextResponse.json(updated, { headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/media/[mediaId] — Soft delete media item
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { mediaId } = await params;
    const idParsed = baseSchemas.uuid.safeParse(mediaId);
    if (!idParsed.success) {
      return NextResponse.json({ error: "Invalid media ID" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      feature: "media delete",
      limitPerIp: 30,
      limitPerUser: 15,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const serviceClient = createServiceClient();
    const { data: item, error: fetchError } = await serviceClient
      .from("media_items")
      .select("id, organization_id, uploaded_by")
      .eq("id", mediaId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !item) {
      return NextResponse.json({ error: "Media item not found" }, { status: 404 });
    }

    // Check org membership
    const membership = await getOrgMembership(supabase, user.id, item.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";
    const isUploader = item.uploaded_by === user.id;

    if (!isAdmin && !isUploader) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check org read-only mode
    const { isReadOnly } = await checkOrgReadOnly(item.organization_id);
    if (isReadOnly) {
      return NextResponse.json(readOnlyResponse(), { status: 403 });
    }

    // Soft delete
    const { error: deleteError } = await serviceClient
      .from("media_items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", mediaId);

    if (deleteError) {
      return NextResponse.json({ error: "Failed to delete media item" }, { status: 500 });
    }

    console.log("[media/gallery] Deleted", { mediaId });

    return NextResponse.json({ success: true }, { headers: rateLimit.headers });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/media/[mediaId] — Moderate media item (admin approve/reject)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { mediaId } = await params;
    const idParsed = baseSchemas.uuid.safeParse(mediaId);
    if (!idParsed.success) {
      return NextResponse.json({ error: "Invalid media ID" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      feature: "media moderate",
      limitPerIp: 60,
      limitPerUser: 30,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const body = await validateJson(request, moderateMediaSchema);

    const serviceClient = createServiceClient();
    const { data: item, error: fetchError } = await serviceClient
      .from("media_items")
      .select("id, organization_id, status")
      .eq("id", mediaId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !item) {
      return NextResponse.json({ error: "Media item not found" }, { status: 404 });
    }

    // Only admins can moderate
    const membership = await getOrgMembership(supabase, user.id, item.organization_id);
    if (!membership || membership.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const newStatus = body.action === "approve" ? "approved" : "rejected";

    const { data: updated, error: updateError } = await serviceClient
      .from("media_items")
      .update({
        status: newStatus,
        moderated_by: user.id,
        moderated_at: new Date().toISOString(),
        rejection_reason: body.action === "reject" ? body.rejectionReason : null,
      })
      .eq("id", mediaId)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json({ error: "Failed to moderate media item" }, { status: 500 });
    }

    return NextResponse.json(updated, { headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
