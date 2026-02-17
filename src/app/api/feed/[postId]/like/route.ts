import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";

export async function POST(request: NextRequest, { params }: { params: { postId: string } }) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit check AFTER auth for mutations
    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      feature: "toggle feed like",
      limitPerIp: 60,
      limitPerUser: 30,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const { postId } = params;

    // Fetch post to check it exists and get org_id
    const { data: post } = await supabase
      .from("feed_posts")
      .select("organization_id")
      .eq("id", postId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    // Check org membership
    const membership = await getOrgMembership(supabase, user.id, post.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    // Check if user already liked this post
    const { data: existingLike } = await supabase
      .from("feed_likes")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingLike) {
      // Unlike: delete the like
      const { error } = await supabase
        .from("feed_likes")
        .delete()
        .eq("id", existingLike.id);

      if (error) {
        return NextResponse.json({ error: "Failed to unlike post" }, { status: 500 });
      }

      return NextResponse.json({ data: { liked: false } }, { headers: rateLimit.headers });
    } else {
      // Like: insert new like
      const { error } = await supabase
        .from("feed_likes")
        .insert({
          post_id: postId,
          user_id: user.id,
          organization_id: post.organization_id,
        });

      if (error) {
        // Handle race condition: unique constraint violation means already liked
        if (error.code === "23505") {
          return NextResponse.json({ data: { liked: true } }, { headers: rateLimit.headers });
        }
        return NextResponse.json({ error: "Failed to like post" }, { status: 500 });
      }

      return NextResponse.json({ data: { liked: true } }, { headers: rateLimit.headers });
    }
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
