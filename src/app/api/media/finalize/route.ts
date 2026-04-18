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

    const { data: signedData } = await serviceClient.storage
      .from(BUCKET)
      .createSignedUrl(media.storage_path, 60);

    if (!signedData?.signedUrl) {
      await serviceClient
        .from("media_uploads")
        .update({ status: "failed" })
        .eq("id", body.mediaId);

      return NextResponse.json(
        { error: "File not found in storage. Upload may have failed." },
        { status: 400, headers: rateLimit.headers },
      );
    }

    const headRes = await fetch(signedData.signedUrl, {
      headers: { Range: `bytes=0-${MAGIC_BYTE_READ_SIZE - 1}` },
    });

    if (!headRes.ok && headRes.status !== 206) {
      await serviceClient
        .from("media_uploads")
        .update({ status: "failed" })
        .eq("id", body.mediaId);

      return NextResponse.json(
        { error: "File not found in storage. Upload may have failed." },
        { status: 400, headers: rateLimit.headers },
      );
    }

    let actualFileSize: number | null = null;
    const contentRange = headRes.headers.get("Content-Range");
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      if (match) actualFileSize = Number.parseInt(match[1], 10);
    }

    if (actualFileSize === null) {
      const headOnly = await fetch(signedData.signedUrl, { method: "HEAD" });
      const contentLength = headOnly.headers.get("Content-Length");
      if (contentLength) actualFileSize = Number.parseInt(contentLength, 10);
    }

    const buffer = Buffer.from(await headRes.arrayBuffer());

    // Validate magic bytes
    const headerBytes = buffer.subarray(0, MAGIC_BYTE_READ_SIZE);
    if (!validateMagicBytes(headerBytes, media.mime_type)) {
      // Delete the spoofed file and mark as failed
      await serviceClient.storage.from(BUCKET).remove(
        [media.storage_path, media.preview_storage_path].filter((path): path is string => Boolean(path)),
      );
      await serviceClient
        .from("media_uploads")
        .update({ status: "failed" })
        .eq("id", body.mediaId);

      return NextResponse.json(
        { error: "File content does not match declared type" },
        { status: 400, headers: rateLimit.headers },
      );
    }

    if (media.preview_storage_path) {
      const previewMimeType = media.preview_storage_path.endsWith(".png")
        ? "image/png"
        : media.preview_storage_path.endsWith(".webp")
          ? "image/webp"
          : media.preview_storage_path.endsWith(".jpg") || media.preview_storage_path.endsWith(".jpeg")
            ? "image/jpeg"
            : null;

      const { data: signedPreviewData } = await serviceClient.storage
        .from(BUCKET)
        .createSignedUrl(media.preview_storage_path, 60);

      if (!previewMimeType || !signedPreviewData?.signedUrl) {
        await serviceClient.storage.from(BUCKET).remove(
          [media.storage_path, media.preview_storage_path].filter((path): path is string => Boolean(path)),
        );
        await serviceClient
          .from("media_uploads")
          .update({ status: "failed" })
          .eq("id", body.mediaId);

        return NextResponse.json(
          { error: "Preview file not found in storage. Upload may have failed." },
          { status: 400, headers: rateLimit.headers },
        );
      }

      const previewRes = await fetch(signedPreviewData.signedUrl, {
        headers: { Range: `bytes=0-${MAGIC_BYTE_READ_SIZE - 1}` },
      });

      if (!previewRes.ok && previewRes.status !== 206) {
        await serviceClient.storage.from(BUCKET).remove(
          [media.storage_path, media.preview_storage_path].filter((path): path is string => Boolean(path)),
        );
        await serviceClient
          .from("media_uploads")
          .update({ status: "failed" })
          .eq("id", body.mediaId);

        return NextResponse.json(
          { error: "Preview file not found in storage. Upload may have failed." },
          { status: 400, headers: rateLimit.headers },
        );
      }

      const previewBuffer = Buffer.from(await previewRes.arrayBuffer());
      const previewHeaderBytes = previewBuffer.subarray(0, MAGIC_BYTE_READ_SIZE);
      if (!validateMagicBytes(previewHeaderBytes, previewMimeType)) {
        await serviceClient.storage.from(BUCKET).remove(
          [media.storage_path, media.preview_storage_path].filter((path): path is string => Boolean(path)),
        );
        await serviceClient
          .from("media_uploads")
          .update({ status: "failed" })
          .eq("id", body.mediaId);

        return NextResponse.json(
          { error: "Preview file content does not match declared type" },
          { status: 400, headers: rateLimit.headers },
        );
      }
    }

    // Update record: status=ready, actual file size, entity link
    const updateData: {
      status: string;
      file_size: number;
      finalized_at: string;
      entity_type?: string;
      entity_id?: string;
    } = {
      status: "ready",
      file_size: actualFileSize ?? media.file_size ?? 0,
      finalized_at: new Date().toISOString(),
    };

    if (body.entityType && body.entityId) {
      updateData.entity_type = body.entityType;
      updateData.entity_id = body.entityId;
    }

    const { error: updateError } = await serviceClient
      .from("media_uploads")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(updateData as any)
      .eq("id", body.mediaId);

    if (updateError) {
      console.error("[media/finalize] Update error:", updateError);
      return NextResponse.json(
        { error: "Failed to finalize upload" },
        { status: 500, headers: rateLimit.headers },
      );
    }

    // Generate signed URLs
    const urls = await getMediaUrls(
      serviceClient,
      media.storage_path,
      media.preview_storage_path,
    );

    return NextResponse.json(
      {
        media: {
          id: body.mediaId,
          originalUrl: urls.originalUrl,
          previewUrl: urls.previewUrl,
          mimeType: media.mime_type,
          fileSize: actualFileSize ?? media.file_size,
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
