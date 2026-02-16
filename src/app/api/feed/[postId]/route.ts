import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createPostSchema } from "@/lib/schemas/feed";
import { validateJson, validationErrorResponse, ValidationError } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { z } from "zod";

export async function GET(request: NextRequest, { params }: { params: { postId: string } }) {
  try {
    // Rate limit check BEFORE auth
    const rateLimit = checkRateLimit(request, {
      feature: "feed post detail",
      limitPerIp: 60,
      limitPerUser: 45,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { postId } = params;

    // Fetch post
    const { data: post, error: postError } = await supabase
      .from("feed_posts")
      .select(
        `
        *,
        author:users!feed_posts_author_id_fkey(name)
      `,
      )
      .eq("id", postId)
      .is("deleted_at", null)
      .maybeSingle();

    if (postError) {
      return NextResponse.json({ error: "Failed to fetch post" }, { status: 500 });
    }

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    // Check org membership
    const membership = await getOrgMembership(supabase, user.id, post.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    // Fetch comments
    const { data: comments, error: commentsError } = await supabase
      .from("feed_comments")
      .select(
        `
        *,
        author:users!feed_comments_author_id_fkey(name)
      `,
      )
      .eq("post_id", postId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (commentsError) {
      return NextResponse.json({ error: "Failed to fetch comments" }, { status: 500 });
    }

    // Check if user has liked this post
    const { data: like } = await supabase
      .from("feed_likes")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", user.id)
      .maybeSingle();

    return NextResponse.json(
      {
        data: {
          post: { ...post, liked_by_user: !!like },
          comments: comments || [],
        },
      },
      { headers: rateLimit.headers },
    );
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { postId: string } }) {
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
      feature: "update feed post",
      limitPerIp: 30,
      limitPerUser: 15,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const { postId } = params;

    const updateSchema = z.object({
      body: createPostSchema.shape.body.optional(),
    });

    const updates = await validateJson(request, updateSchema);

    // Fetch post
    const { data: post } = await supabase
      .from("feed_posts")
      .select("author_id, organization_id")
      .eq("id", postId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    // Check if user is author or admin
    const membership = await getOrgMembership(supabase, user.id, post.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";
    const isAuthor = post.author_id === user.id;

    if (!isAuthor && !isAdmin) {
      return NextResponse.json({ error: "Only the author or admin can edit this post" }, { status: 403 });
    }

    // Update post
    const { data: updatedPost, error } = await supabase
      .from("feed_posts")
      .update(updates)
      .eq("id", postId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to update post" }, { status: 500 });
    }

    return NextResponse.json({ data: updatedPost }, { headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { postId: string } }) {
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
      feature: "delete feed post",
      limitPerIp: 30,
      limitPerUser: 15,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const { postId } = params;

    // Fetch post
    const { data: post } = await supabase
      .from("feed_posts")
      .select("author_id, organization_id")
      .eq("id", postId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    // Check if user is author or admin
    const membership = await getOrgMembership(supabase, user.id, post.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";
    const isAuthor = post.author_id === user.id;

    if (!isAuthor && !isAdmin) {
      return NextResponse.json({ error: "Only the author or admin can delete this post" }, { status: 403 });
    }

    // Soft delete
    const { error } = await supabase
      .from("feed_posts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", postId);

    if (error) {
      return NextResponse.json({ error: "Failed to delete post" }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { headers: rateLimit.headers });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
