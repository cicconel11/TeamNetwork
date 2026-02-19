import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createPostSchema } from "@/lib/schemas/feed";
import { validateJson, validationErrorResponse, ValidationError, baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { linkMediaToEntity } from "@/lib/media/link";
import { fetchMediaForEntities } from "@/lib/media/fetch";
import { z } from "zod";

export async function GET(request: NextRequest) {
  try {
    // Rate limit check BEFORE auth
    const rateLimit = checkRateLimit(request, {
      feature: "feed list",
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

    const searchParams = request.nextUrl.searchParams;
    const orgIdParam = searchParams.get("orgId");
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");

    if (!orgIdParam) {
      return NextResponse.json({ error: "orgId query parameter is required" }, { status: 400 });
    }

    const orgIdSchema = z.object({ orgId: baseSchemas.uuid });
    const parsed = orgIdSchema.safeParse({ orgId: orgIdParam });

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid orgId format" }, { status: 400 });
    }

    const { orgId } = parsed.data;

    // Parse pagination params
    const page = Math.max(1, parseInt(pageParam || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(limitParam || "25", 10)));
    const offset = (page - 1) * limit;

    // Check org membership
    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    // Fetch posts with author info and count
    const { data: posts, error, count } = await supabase
      .from("feed_posts")
      .select(
        `
        *,
        author:users!feed_posts_author_id_fkey(name)
      `,
        { count: "exact", head: false },
      )
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: "Failed to fetch posts" }, { status: 500 });
    }

    // Fetch user's likes for these posts
    const postIds = (posts || []).map((p) => p.id);
    let userLikedPostIds: Set<string> = new Set();

    if (postIds.length > 0) {
      const { data: likes } = await supabase
        .from("feed_likes")
        .select("post_id")
        .eq("user_id", user.id)
        .in("post_id", postIds);

      userLikedPostIds = new Set((likes || []).map((l) => l.post_id));
    }

    // Fetch media attachments for all posts
    const serviceClient = createServiceClient();
    const mediaMap = postIds.length > 0
      ? await fetchMediaForEntities(serviceClient, "feed_post", postIds)
      : new Map();

    // Augment posts with liked_by_user and media
    const augmentedPosts = (posts || []).map((post) => ({
      ...post,
      liked_by_user: userLikedPostIds.has(post.id),
      media: mediaMap.get(post.id) ?? [],
    }));

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    return NextResponse.json(
      {
        data: augmentedPosts,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
      { headers: rateLimit.headers },
    );
  } catch (error) {
    console.error("[FEED API DEBUG] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
      feature: "create feed post",
      limitPerIp: 15,
      limitPerUser: 5,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const bodySchema = z.object({
      orgId: baseSchemas.uuid,
      body: createPostSchema.shape.body,
      mediaIds: createPostSchema.shape.mediaIds,
    });

    const { orgId, body, mediaIds } = await validateJson(request, bodySchema);

    // Check org membership
    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    // Check feed_post_roles
    const { data: org } = await supabase
      .from("organizations")
      .select("feed_post_roles")
      .eq("id", orgId)
      .maybeSingle();

    const allowedRoles: string[] = (org?.feed_post_roles as string[] | null) || ["admin", "active_member", "alumni"];
    if (!allowedRoles.includes(membership.role)) {
      return NextResponse.json({ error: "Your role is not allowed to create posts" }, { status: 403 });
    }

    // Create post
    const { data: post, error } = await supabase
      .from("feed_posts")
      .insert({
        organization_id: orgId,
        author_id: user.id,
        body,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
    }

    // Link media attachments if provided
    if (mediaIds && mediaIds.length > 0) {
      const serviceClient = createServiceClient();
      const linkResult = await linkMediaToEntity(serviceClient, {
        mediaIds,
        entityType: "feed_post",
        entityId: post.id,
        orgId,
        userId: user.id,
      });
      if (linkResult.error) {
        // Clean up orphaned post to prevent duplicates on retry
        await serviceClient.from("feed_posts").update({ deleted_at: new Date().toISOString() }).eq("id", post.id);
        return NextResponse.json({ error: linkResult.error }, { status: 400, headers: rateLimit.headers });
      }
    }

    return NextResponse.json({ data: post }, { status: 201, headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
