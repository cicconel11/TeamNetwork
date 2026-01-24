import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: { feedId: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to remove feeds." },
        { status: 401 }
      );
    }

    const { data: feed, error } = await supabase
      .from("calendar_feeds")
      .select("id")
      .eq("id", params.feedId)
      .eq("user_id", user.id)
      .single();

    if (error || !feed) {
      return NextResponse.json(
        { error: "Not found", message: "Feed not found." },
        { status: 404 }
      );
    }

    const { error: deleteError } = await supabase
      .from("calendar_feeds")
      .delete()
      .eq("id", feed.id);

    if (deleteError) {
      console.error("[calendar-feeds] Failed to delete feed:", deleteError);
      return NextResponse.json(
        { error: "Database error", message: "Failed to delete feed." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[calendar-feeds] Error deleting feed:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to delete feed." },
      { status: 500 }
    );
  }
}
