/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { validateJson, ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { reorderMediaGallerySchema } from "@/lib/schemas/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function mapRpcError(message: string | undefined): string {
  if (!message) return "Failed to reorder media";
  if (message.includes("media_count_mismatch")) {
    return "Media list must match the current gallery for this organization";
  }
  if (message.includes("duplicate_media_id")) {
    return "Duplicate media ids in reorder request";
  }
  if (message.includes("invalid_media_id")) {
    return "One or more items are invalid for this organization";
  }
  return "Failed to reorder media";
}

/**
 * PATCH /api/media/reorder
 * Body: { orgId, mediaIds } — full permutation of all non-deleted media ids for the org.
 */
export async function PATCH(request: NextRequest) {
  try {
    const rateLimit = checkRateLimit(request, {
      feature: "media gallery reorder",
      limitPerIp: 30,
      limitPerUser: 25,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await validateJson(request, reorderMediaGallerySchema);
    const { orgId, mediaIds } = body;

    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    // Full-gallery reorder requires seeing every item in the org (incl. pending). Only admins can do that.
    if (membership.role !== "admin") {
      return NextResponse.json({ error: "Only organization admins can reorder the gallery" }, { status: 403 });
    }

    const serviceClient = createServiceClient();

    const { error: rpcError } = await (serviceClient as any).rpc("reorder_media_gallery", {
      p_org_id: orgId,
      p_media_ids: mediaIds,
    });

    if (rpcError) {
      console.error("[media/reorder] RPC failed:", rpcError);
      const msg = mapRpcError(rpcError.message);
      const clientError =
        rpcError.message?.includes("media_count_mismatch")
        || rpcError.message?.includes("duplicate_media_id")
        || rpcError.message?.includes("invalid_media_id");
      return NextResponse.json(
        { error: msg },
        { status: clientError ? 400 : 500, headers: rateLimit.headers },
      );
    }

    return NextResponse.json({ success: true }, { headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) return validationErrorResponse(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
