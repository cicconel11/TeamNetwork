import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCommentSchema } from "@/lib/schemas/feed";
import { validateJson, validationErrorResponse, ValidationError } from "@/lib/security/validation";
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
      feature: "create feed comment",
      limitPerIp: 15,
      limitPerUser: 8,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const { postId } = params;
    const { body } = await validateJson(request, createCommentSchema);

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

    // Create comment
    const { data: comment, error } = await supabase
      .from("feed_comments")
      .insert({
        post_id: postId,
        organization_id: post.organization_id,
        author_id: user.id,
        body,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to create comment" }, { status: 500 });
    }

    return NextResponse.json({ data: comment }, { status: 201, headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
