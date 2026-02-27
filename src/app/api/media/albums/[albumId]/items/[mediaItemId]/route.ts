import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { ValidationError, validationErrorResponse } from "@/lib/security/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: { albumId: string; mediaItemId: string } };

/**
 * DELETE /api/media/albums/[albumId]/items/[mediaItemId]?orgId=
 * Remove a single item from the album. Auth: album creator or admin.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { albumId, mediaItemId } = params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("orgId");
    if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });

    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";
    const serviceClient = createServiceClient();

    // Verify album belongs to org and user has permission
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

    const { error: deleteError } = await serviceClient
      .from("media_album_items")
      .delete()
      .eq("album_id", albumId)
      .eq("media_item_id", mediaItemId);

    if (deleteError) {
      console.error("[media/albums/items/[mediaItemId]] Delete failed:", deleteError);
      return NextResponse.json({ error: "Failed to remove item from album" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) return validationErrorResponse(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
