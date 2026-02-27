import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { validateJson, ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { z } from "zod";
import { baseSchemas } from "@/lib/security/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const addItemsSchema = z.object({
  orgId: baseSchemas.uuid,
  mediaIds: z.array(baseSchemas.uuid).min(1).max(50),
});

type Params = { params: { albumId: string } };

/**
 * POST /api/media/albums/[albumId]/items
 * Batch-add media items to an album. Auth: album creator or admin.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { albumId } = params;

    const rateLimit = checkRateLimit(request, {
      feature: "media album add items",
      limitPerIp: 30,
      limitPerUser: 20,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await validateJson(request, addItemsSchema);
    const { orgId, mediaIds } = body;

    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";
    const serviceClient = createServiceClient();

    // Verify album exists and user has permission
    const { data: album, error: albumError } = await (serviceClient as any)
      .from("media_albums")
      .select("id, created_by, organization_id")
      .eq("id", albumId)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (albumError || !album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    if (!isAdmin && album.created_by !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Validate all media items belong to this org
    const { data: validItems, error: itemsError } = await serviceClient
      .from("media_items")
      .select("id")
      .in("id", mediaIds)
      .eq("organization_id", orgId)
      .is("deleted_at", null);

    if (itemsError) {
      return NextResponse.json({ error: "Failed to validate media items" }, { status: 500 });
    }

    const validIds = new Set((validItems || []).map((i: { id: string }) => i.id));
    const invalidIds = mediaIds.filter((id) => !validIds.has(id));
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: "Some media items not found or not in this organization" },
        { status: 400 },
      );
    }

    // Batch upsert (ignore duplicates via ON CONFLICT DO NOTHING)
    const rows = mediaIds.map((mediaId, i) => ({
      album_id: albumId,
      media_item_id: mediaId,
      sort_order: i,
    }));

    const { error: insertError } = await serviceClient
      .from("media_album_items")
      .upsert(rows, { onConflict: "album_id,media_item_id", ignoreDuplicates: true });

    if (insertError) {
      console.error("[media/albums/items] Insert failed:", insertError);
      return NextResponse.json({ error: "Failed to add items to album" }, { status: 500 });
    }

    return NextResponse.json({ success: true, added: mediaIds.length }, { headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) return validationErrorResponse(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
