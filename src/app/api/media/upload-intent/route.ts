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
import type { MediaFeature } from "@/lib/media/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "org-media";

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
        return NextResponse.json(
          { error: "Your role is not allowed to upload for this feature" },
          { status: 403, headers: rateLimit.headers },
        );
      }
    }

    // Block uploads if org is in read-only mode
    const { isReadOnly } = await checkOrgReadOnly(body.orgId);
    if (isReadOnly) {
      return NextResponse.json(readOnlyResponse(), { status: 403, headers: rateLimit.headers });
    }

    // Validate file constraints for the feature
    const constraintError = validateFileConstraints(
      body.feature as MediaFeature,
      body.mimeType,
      body.fileSize,
    );
    if (constraintError) {
      return NextResponse.json(
        { error: constraintError },
        { status: 400, headers: rateLimit.headers },
      );
    }

    // Generate storage path
    const ext = extname(body.fileName).replace(".", "").toLowerCase() || "bin";
    const storagePath = `${body.orgId}/${body.feature}/${randomUUID()}.${ext}`;

    const serviceClient = createServiceClient();

    // Create signed upload URL
    const { data: signedData, error: signedError } = await serviceClient.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath);

    if (signedError || !signedData) {
      console.error("[media/upload-intent] Signed URL error:", signedError);
      return NextResponse.json(
        { error: "Failed to create upload URL" },
        { status: 500, headers: rateLimit.headers },
      );
    }

    // Insert media_uploads record
    const { data: mediaRecord, error: insertError } = await serviceClient
      .from("media_uploads")
      .insert({
        organization_id: body.orgId,
        uploader_id: user.id,
        storage_path: storagePath,
        file_name: body.fileName,
        mime_type: body.mimeType,
        file_size: body.fileSize,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError || !mediaRecord) {
      console.error("[media/upload-intent] Insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to create media record" },
        { status: 500, headers: rateLimit.headers },
      );
    }

    console.log("[media/upload-intent] Created", { orgId: body.orgId, mediaId: mediaRecord.id, feature: body.feature });

    return NextResponse.json(
      {
        mediaId: mediaRecord.id,
        signedUrl: signedData.signedUrl,
        token: signedData.token,
        path: signedData.path,
      },
      { status: 201, headers: rateLimit.headers },
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    console.error("[media/upload-intent] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
