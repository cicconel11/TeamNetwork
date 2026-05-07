import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCommentSchema } from "@/lib/schemas/feed";
import { validateJson, validationErrorResponse, ValidationError } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { postId: string; commentId: string } },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      feature: "edit feed comment",
      limitPerIp: 15,
      limitPerUser: 8,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const { commentId } = params;
    const { body } = await validateJson(request, createCommentSchema);

    // Fetch comment to verify ownership
    const { data: comment } = await supabase
      .from("feed_comments")
      .select("author_id")
      .eq("id", commentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    if (comment.author_id !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const { data: updated, error } = await supabase
      .from("feed_comments")
      .update({ body })
      .eq("id", commentId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to update comment" }, { status: 500 });
    }

    return NextResponse.json({ data: updated }, { headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { postId: string; commentId: string } },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      feature: "delete feed comment",
      limitPerIp: 30,
      limitPerUser: 15,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const { commentId } = params;

    // Fetch comment to verify ownership
    const { data: comment } = await supabase
      .from("feed_comments")
      .select("author_id")
      .eq("id", commentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    // Only the comment author can delete their own comment
    if (comment.author_id !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Soft delete
    const { error } = await supabase
      .from("feed_comments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", commentId);

    if (error) {
      return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { headers: rateLimit.headers });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
