/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { validateJson, ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { reorderAlbumsSchema } from "@/lib/schemas/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function mapRpcError(message: string | undefined): string {
  if (!message) return "Failed to reorder albums";
  if (message.includes("album_count_mismatch")) {
    return "Album list must match the current albums for this organization";
  }
  if (message.includes("duplicate_album_id")) {
    return "Duplicate album ids in reorder request";
  }
  if (message.includes("invalid_album_id")) {
    return "One or more albums are invalid for this organization";
  }
  return "Failed to reorder albums";
}

/**
 * PATCH /api/media/albums/reorder
 * Body: { orgId, albumIds } — full permutation of all non-deleted album ids for the org.
 */
export async function PATCH(request: NextRequest) {
  try {
    const rateLimit = checkRateLimit(request, {
      feature: "media albums reorder",
      limitPerIp: 30,
      limitPerUser: 25,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await validateJson(request, reorderAlbumsSchema);
    const { orgId, albumIds } = body;

    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const serviceClient = createServiceClient();

    const { data: org } = await serviceClient
      .from("organizations")
      .select("media_upload_roles")
      .eq("id", orgId)
      .maybeSingle();

    const allowedRoles = (org as Record<string, unknown> | null)?.media_upload_roles as string[] || ["admin", "active_member"];
    if (!allowedRoles.includes(membership.role)) {
      return NextResponse.json({ error: "You do not have permission to reorder albums" }, { status: 403 });
    }

    const { error: rpcError } = await (serviceClient as any).rpc("reorder_media_albums", {
      p_org_id: orgId,
      p_album_ids: albumIds,
    });

    if (rpcError) {
      console.error("[media/albums/reorder] RPC failed:", rpcError);
      const msg = mapRpcError(rpcError.message);
      const clientError =
        rpcError.message?.includes("album_count_mismatch")
        || rpcError.message?.includes("duplicate_album_id")
        || rpcError.message?.includes("invalid_album_id");
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
