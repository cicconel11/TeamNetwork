import { randomUUID } from "crypto";
import { extname } from "path";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { uploadIntentSchema } from "@/lib/schemas/media";
import { validateJson, validationErrorResponse, ValidationError } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import { validateFileConstraints } from "@/lib/media/validation";
import { isImageMimeType, type MediaFeature } from "@/lib/media/constants";
import { checkStorageQuota } from "@/lib/media/storage-quota";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "org-media";
type MediaUploadInsert = Database["public"]["Tables"]["media_uploads"]["Insert"] & {
  preview_file_size?: number | null;
};

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "video/mp4") return "mp4";
  return "jpg";
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      feature: "media upload intent",
      limitPerIp: 15,
      limitPerUser: 10,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const body = await validateJson(request, uploadIntentSchema);

    // Check org membership
    const membership = await getOrgMembership(supabase, user.id, body.orgId);
    if (!membership) {
      console.warn("[media/upload-intent] rejected", {
        orgId: body.orgId,
        userId: user.id,
        reason: "not_member",
      });
      return NextResponse.json(
        { error: "Not a member of this organization" },
        { status: 403, headers: rateLimit.headers },
      );
    }

    // Check feature-level posting roles
    const featureRoleColumns: Record<string, string> = {
      feed_post: "feed_post_roles",
      discussion_thread: "discussion_post_roles",
      job_posting: "job_post_roles",
    };
    const featureDefaults: Record<string, string[]> = {
      feed_post: ["admin", "active_member", "alumni"],
      discussion_thread: ["admin", "active_member", "alumni"],
      job_posting: ["admin", "alumni"],
    };
    const roleColumn = featureRoleColumns[body.feature];
    if (roleColumn) {
      const { data: org } = await supabase
        .from("organizations")
        .select(roleColumn)
        .eq("id", body.orgId)
        .maybeSingle();

      const allowedRoles: string[] =
        (org as Record<string, unknown> | null)?.[roleColumn] as string[] ||
        featureDefaults[body.feature];
      if (!allowedRoles.includes(membership.role)) {
        console.warn("[media/upload-intent] rejected", {
          orgId: body.orgId,
          userId: user.id,
          reason: "role_denied",
          feature: body.feature,
          role: membership.role,
        });
        return NextResponse.json(
          { error: "Your role is not allowed to upload for this feature" },
          { status: 403, headers: rateLimit.headers },
        );
      }
    }

    // Block uploads if org is in read-only mode
    const { isReadOnly } = await checkOrgReadOnly(body.orgId);
    if (isReadOnly) {
      console.warn("[media/upload-intent] rejected", {
        orgId: body.orgId,
        userId: user.id,
        reason: "read_only",
      });
      return NextResponse.json(readOnlyResponse(), { status: 403, headers: rateLimit.headers });
    }

    // Validate file constraints for the feature
    const constraintError = validateFileConstraints(
      body.feature as MediaFeature,
      body.mimeType,
      body.fileSize,
    );
    if (constraintError) {
      console.warn("[media/upload-intent] rejected", {
        orgId: body.orgId,
        userId: user.id,
        reason: "constraint_violation",
        feature: body.feature,
        mimeType: body.mimeType,
        fileSize: body.fileSize,
        error: constraintError,
      });
      return NextResponse.json(
        { error: constraintError },
        { status: 400, headers: rateLimit.headers },
      );
    }

    // Per-org storage quota enforcement (fail-closed on lookup error).
    const serviceClient = createServiceClient();
    const quota = await checkStorageQuota(
      serviceClient,
      body.orgId,
      body.fileSize,
      body.previewFileSize ?? 0,
    );
    if (!quota.ok) {
      if (quota.reason === "lookup_failed") {
        console.warn("[media/upload-intent] rejected", {
          orgId: body.orgId,
          userId: user.id,
          reason: "quota_lookup_failed",
        });
        return NextResponse.json(
          { error: "Failed to verify storage quota" },
          { status: 500, headers: rateLimit.headers },
        );
      }
      console.warn("[media/upload-intent] rejected", {
        orgId: body.orgId,
        userId: user.id,
        reason: "quota_exceeded",
        usedBytes: quota.usedBytes,
        quotaBytes: quota.quotaBytes,
      });
      return NextResponse.json(
        {
          error: "Storage quota exceeded",
          code: "STORAGE_QUOTA_EXCEEDED",
          usedBytes: quota.usedBytes,
          quotaBytes: quota.quotaBytes,
        },
        { status: 507, headers: rateLimit.headers },
      );
    }

    // Generate storage path
    const ext = extname(body.fileName).replace(".", "").toLowerCase() || "bin";
    const storagePath = `${body.orgId}/${body.feature}/${randomUUID()}.${ext}`;
    const previewStoragePath = isImageMimeType(body.mimeType) && body.previewMimeType
      ? `${storagePath.replace(/\.[^.]+$/, "")}-preview.${extensionForMimeType(body.previewMimeType)}`
      : null;

    const [signedOriginal, signedPreview] = await Promise.all([
      serviceClient.storage.from(BUCKET).createSignedUploadUrl(storagePath),
      previewStoragePath
        ? serviceClient.storage.from(BUCKET).createSignedUploadUrl(previewStoragePath)
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (signedOriginal.error || !signedOriginal.data) {
      console.warn("[media/upload-intent] rejected", {
        orgId: body.orgId,
        userId: user.id,
        reason: "signed_url_failed",
        target: "original",
      });
      console.error("[media/upload-intent] Signed URL error:", signedOriginal.error);
      return NextResponse.json(
        { error: "Failed to create upload URL" },
        { status: 500, headers: rateLimit.headers },
      );
    }

    if (previewStoragePath && (signedPreview.error || !signedPreview.data)) {
      console.warn("[media/upload-intent] rejected", {
        orgId: body.orgId,
        userId: user.id,
        reason: "signed_url_failed",
        target: "preview",
      });
      console.error("[media/upload-intent] Preview signed URL error:", signedPreview.error);
      return NextResponse.json(
        { error: "Failed to create preview upload URL" },
        { status: 500, headers: rateLimit.headers },
      );
    }

    // Insert media_uploads record
    const uploadRecord: MediaUploadInsert = {
      organization_id: body.orgId,
      uploader_id: user.id,
      storage_path: storagePath,
      preview_storage_path: previewStoragePath,
      file_name: body.fileName,
      mime_type: body.mimeType,
      file_size: body.fileSize,
      preview_file_size: body.previewFileSize ?? null,
      status: "pending",
    };

    const { data: mediaRecord, error: insertError } = await serviceClient
      .from("media_uploads")
      .insert(uploadRecord)
      .select("id")
      .single();

    if (insertError || !mediaRecord) {
      console.warn("[media/upload-intent] rejected", {
        orgId: body.orgId,
        userId: user.id,
        reason: "insert_failed",
        feature: body.feature,
      });
      console.error("[media/upload-intent] Insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to create media record" },
        { status: 500, headers: rateLimit.headers },
      );
    }

    console.log("[media/upload-intent] Created", {
      orgId: body.orgId,
      mediaId: mediaRecord.id,
      feature: body.feature,
      hasPreviewUpload: Boolean(previewStoragePath),
    });

    return NextResponse.json(
      {
        mediaId: mediaRecord.id,
        signedUrl: signedOriginal.data.signedUrl,
        token: signedOriginal.data.token,
        path: signedOriginal.data.path,
        previewSignedUrl: signedPreview.data?.signedUrl ?? null,
        previewToken: signedPreview.data?.token ?? null,
        previewPath: signedPreview.data?.path ?? null,
      },
      { status: 201, headers: rateLimit.headers },
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      console.warn("[media/upload-intent] validation rejected", {
        reason: "schema_invalid",
        details: error.details,
      });
      return validationErrorResponse(error);
    }
    console.error("[media/upload-intent] internal error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
