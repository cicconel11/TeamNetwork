import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ feedId: string }>;
}

export async function DELETE(
  request: Request,
  { params }: RouteParams
) {
  try {
    const { feedId } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "calendar feed deletion",
      limitPerIp: 30,
      limitPerUser: 20,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    if (authError || !user) {
      return respond(
        { error: "Unauthorized", message: "You must be logged in to remove feeds." },
        401
      );
    }

    const { data: feed, error } = await supabase
      .from("calendar_feeds")
      .select("id, organization_id")
      .eq("id", feedId)
      .eq("user_id", user.id)
      .eq("scope", "personal")
      .single();

    if (error || !feed) {
      return respond(
        { error: "Not found", message: "Feed not found." },
        404
      );
    }

    // Block mutations if org is in grace period (read-only mode)
    const { isReadOnly } = await checkOrgReadOnly(feed.organization_id);
    if (isReadOnly) {
      return respond(readOnlyResponse(), 403);
    }

    const { error: deleteError } = await supabase
      .from("calendar_feeds")
      .delete()
      .eq("id", feed.id);

    if (deleteError) {
      console.error("[calendar-feeds] Failed to delete feed:", deleteError);
      return respond(
        { error: "Database error", message: "Failed to delete feed." },
        500
      );
    }

    return respond({ success: true });
  } catch (error) {
    console.error("[calendar-feeds] Error deleting feed:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to delete feed." },
      { status: 500 }
    );
  }
}
