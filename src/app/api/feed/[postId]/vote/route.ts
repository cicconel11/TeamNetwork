import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { voteSchema } from "@/lib/schemas/chat-polls";
import { validateJson, validationErrorResponse, ValidationError } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import type { PollMetadata } from "@/components/feed/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
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
      feature: "feed poll vote",
      limitPerIp: 15,
      limitPerUser: 8,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const { postId } = await params;
    const { option_index } = await validateJson(request, voteSchema);

    // Fetch the post to verify it's a poll
    const { data: post } = await supabase
      .from("feed_posts")
      .select("organization_id, post_type, metadata")
      .eq("id", postId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.post_type !== "poll" || !post.metadata) {
      return NextResponse.json({ error: "Post is not a poll" }, { status: 400 });
    }

    const meta = post.metadata as PollMetadata;

    if (option_index >= meta.options.length) {
      return NextResponse.json({ error: "Invalid option index" }, { status: 400 });
    }

    // Check org membership
    const membership = await getOrgMembership(supabase, user.id, post.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    // Check if user already voted
    const { data: existingVote } = await supabase
      .from("feed_poll_votes")
      .select("id, option_index")
      .eq("post_id", postId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingVote) {
      if (!meta.allow_change) {
        return NextResponse.json(
          { error: "Vote cannot be changed on this poll" },
          { status: 409, headers: rateLimit.headers },
        );
      }
      // Update existing vote
      const { error: updateError } = await supabase
        .from("feed_poll_votes")
        .update({ option_index, updated_at: new Date().toISOString() })
        .eq("id", existingVote.id);

      if (updateError) {
        return NextResponse.json({ error: "Failed to update vote" }, { status: 500 });
      }
    } else {
      // Insert new vote
      const { error: insertError } = await supabase
        .from("feed_poll_votes")
        .insert({
          post_id: postId,
          user_id: user.id,
          organization_id: post.organization_id,
          option_index,
        });

      if (insertError) {
        return NextResponse.json({ error: "Failed to cast vote" }, { status: 500 });
      }
    }

    return NextResponse.json(
      { success: true, option_index },
      { headers: rateLimit.headers },
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { postId } = await params;

    const { error } = await supabase
      .from("feed_poll_votes")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: "Failed to remove vote" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
