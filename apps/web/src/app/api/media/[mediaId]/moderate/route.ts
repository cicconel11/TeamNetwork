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
import { moderateMediaSchema } from "@/lib/schemas/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ mediaId: string }>;
}

/**
 * POST /api/media/[mediaId]/moderate — Approve or reject a pending media item (admin only)
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
    const { action, rejectionReason } = body;

    const serviceClient = createServiceClient();

    // Fetch the media item
    const { data: item, error: fetchError } = await serviceClient
      .from("media_items")
      .select("id, organization_id, status")
      .eq("id", mediaId)
      .is("deleted_at", null)
      .single();

    if (fetchError || !item) {
      return NextResponse.json({ error: "Media item not found" }, { status: 404 });
    }

    // Admin-only check
    const membership = await getOrgMembership(supabase, user.id, item.organization_id);
    if (!membership || membership.role !== "admin") {
      return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
    }

    // Item must be in 'pending' status
    if (item.status !== "pending") {
      return NextResponse.json(
        { error: `Cannot moderate item with status '${item.status}'. Only 'pending' items can be moderated.` },
        { status: 409 },
      );
    }

    // Determine new status
    const newStatus = action === "approve" ? "approved" : "rejected";

    // Race-condition-safe update: WHERE status='pending' ensures only one admin succeeds
    const { data: updated, error: updateError } = await serviceClient
      .from("media_items")
      .update({
        status: newStatus,
        moderated_by: user.id,
        moderated_at: new Date().toISOString(),
        rejection_reason: action === "reject" ? rejectionReason : null,
      })
      .eq("id", mediaId)
      .eq("status", "pending") // Optimistic lock
      .select("*")
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "Failed to moderate — item may have already been moderated" },
        { status: 409 },
      );
    }

    console.log("[media/gallery] Moderated", { mediaId, action: newStatus });

    return NextResponse.json(updated, { headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
