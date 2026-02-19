import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { finalizeUploadSchema } from "@/lib/schemas/media";
import { validateJson, validationErrorResponse, ValidationError } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateMagicBytes } from "@/lib/media/validation";
import { getMediaUrls } from "@/lib/media/urls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "org-media";
const MAGIC_BYTE_READ_SIZE = 16;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      feature: "media finalize",
      limitPerIp: 15,
      limitPerUser: 10,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const body = await validateJson(request, finalizeUploadSchema);
    const serviceClient = createServiceClient();

    // Fetch the media record
    const { data: media, error: fetchError } = await serviceClient
      .from("media_uploads")
      .select("*")
      .eq("id", body.mediaId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !media) {
      return NextResponse.json(
        { error: "Media upload not found" },
        { status: 404, headers: rateLimit.headers },
      );
    }

    // Verify ownership and org
    if (media.uploader_id !== user.id) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403, headers: rateLimit.headers },
      );
    }

    if (media.organization_id !== body.orgId) {
      return NextResponse.json(
        { error: "Organization mismatch" },
        { status: 400, headers: rateLimit.headers },
      );
    }

    if (media.status !== "pending") {
      return NextResponse.json(
        { error: `Upload already ${media.status}` },
        { status: 409, headers: rateLimit.headers },
      );
    }

    // Download first bytes from storage for magic byte validation
    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from(BUCKET)
      .download(media.storage_path);

    if (downloadError || !fileData) {
      // File not uploaded yet or storage error
      await serviceClient
        .from("media_uploads")
        .update({ status: "failed" })
        .eq("id", body.mediaId);

      return NextResponse.json(
        { error: "File not found in storage. Upload may have failed." },
        { status: 400, headers: rateLimit.headers },
      );
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate magic bytes
    const headerBytes = buffer.subarray(0, MAGIC_BYTE_READ_SIZE);
    if (!validateMagicBytes(headerBytes, media.mime_type)) {
      // Delete the spoofed file and mark as failed
      await serviceClient.storage.from(BUCKET).remove([media.storage_path]);
      await serviceClient
        .from("media_uploads")
        .update({ status: "failed" })
        .eq("id", body.mediaId);

      return NextResponse.json(
        { error: "File content does not match declared type" },
        { status: 400, headers: rateLimit.headers },
      );
    }

    // Update record: status=ready, actual file size, entity link
    const updateData: Record<string, unknown> = {
      status: "ready",
      file_size: buffer.byteLength,
      finalized_at: new Date().toISOString(),
    };

    if (body.entityType && body.entityId) {
      updateData.entity_type = body.entityType;
      updateData.entity_id = body.entityId;
    }

    const { error: updateError } = await serviceClient
      .from("media_uploads")
      .update(updateData)
      .eq("id", body.mediaId);

    if (updateError) {
      console.error("[media/finalize] Update error:", updateError);
      return NextResponse.json(
        { error: "Failed to finalize upload" },
        { status: 500, headers: rateLimit.headers },
      );
    }

    console.log("[media/finalize] Success", { mediaId: body.mediaId });

    // Generate signed URLs
    const urls = await getMediaUrls(serviceClient, media.storage_path, media.mime_type);

    return NextResponse.json(
      {
        media: {
          id: body.mediaId,
          url: urls.url,
          thumbnailUrl: urls.thumbnailUrl,
          mimeType: media.mime_type,
          fileSize: buffer.byteLength,
          fileName: media.file_name,
        },
      },
      { headers: rateLimit.headers },
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    console.error("[media/finalize] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
