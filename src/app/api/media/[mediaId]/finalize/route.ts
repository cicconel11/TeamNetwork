import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { validateMagicBytes } from "@/lib/media/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ mediaId: string }>;
}

const MAGIC_BYTES_LENGTH = 12;

/**
 * POST /api/media/[mediaId]/finalize — Finalize an upload after client uploads to signed URL.
 * Verifies file exists in storage and validates magic bytes to prevent MIME spoofing.
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
      feature: "media finalize",
      limitPerIp: 20,
      limitPerUser: 10,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const serviceClient = createServiceClient();

    // Fetch the media item — must be status='uploading' and owned by the user
    const { data: item, error: fetchError } = await serviceClient
      .from("media_items")
      .select("id, storage_path, mime_type, uploaded_by, status, organization_id")
      .eq("id", mediaId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !item) {
      return NextResponse.json({ error: "Media item not found" }, { status: 404 });
    }

    if (item.uploaded_by !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (item.status !== "uploading") {
      return NextResponse.json(
        { error: "Media item is not in uploading state" },
        { status: 409 },
      );
    }

    if (!item.storage_path) {
      return NextResponse.json({ error: "No storage path for this item" }, { status: 400 });
    }

    // Create short-lived signed URL for range request (avoids downloading entire file)
    const { data: signedData } = await serviceClient.storage
      .from("org-media")
      .createSignedUrl(item.storage_path, 60);

    if (!signedData?.signedUrl) {
      return NextResponse.json(
        { error: "File not found in storage. Please upload the file first." },
        { status: 400 },
      );
    }

    // Fetch only first 12 bytes via range request for magic bytes validation
    const headRes = await fetch(signedData.signedUrl, {
      headers: { Range: "bytes=0-11" },
    });

    if (!headRes.ok && headRes.status !== 206) {
      return NextResponse.json(
        { error: "File not found in storage. Please upload the file first." },
        { status: 400 },
      );
    }

    const arrayBuffer = await headRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (item.mime_type && !validateMagicBytes(buffer, item.mime_type)) {
      // File content doesn't match declared MIME type — reject
      // Clean up the uploaded file and mark item as rejected
      console.error("[media/gallery] Magic bytes mismatch — rejected", { mediaId });
      await serviceClient.storage.from("org-media").remove([item.storage_path]);
      await serviceClient
        .from("media_items")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", mediaId);

      return NextResponse.json(
        { error: "File content does not match declared type. Upload rejected." },
        { status: 400 },
      );
    }

    // Determine final status: admin uploads auto-approve, others go to moderation
    const membership = await getOrgMembership(supabase, user.id, item.organization_id);
    const finalStatus = membership?.role === "admin" ? "approved" : "pending";

    const { data: updated, error: updateError } = await serviceClient
      .from("media_items")
      .update({ status: finalStatus })
      .eq("id", mediaId)
      .eq("status", "uploading") // Optimistic lock
      .select("id, status")
      .single();

    if (updateError || !updated) {
      return NextResponse.json({ error: "Failed to finalize upload" }, { status: 500 });
    }

    console.log("[media/gallery] Finalize success", { mediaId });

    return NextResponse.json(
      { mediaId: updated.id, status: updated.status },
      { headers: rateLimit.headers },
    );
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
