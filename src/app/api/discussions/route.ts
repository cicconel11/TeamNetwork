import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createThreadSchema } from "@/lib/schemas/discussion";
import { notifyNewThread } from "@/lib/discussions/notifications";
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
      feature: "discussions list",
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

    // Fetch threads with author info and count
    const { data: threads, error, count } = await supabase
      .from("discussion_threads")
      .select(
        `
        *,
        author:users!discussion_threads_author_id_fkey(name)
      `,
        { count: "exact", head: false },
      )
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("is_pinned", { ascending: false })
      .order("last_activity_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: "Failed to fetch threads" }, { status: 500 });
    }

    // Fetch media attachments for all threads
    const threadIds = (threads || []).map((t) => t.id);
    const serviceClient = createServiceClient();
    const mediaMap = threadIds.length > 0
      ? await fetchMediaForEntities(serviceClient, "discussion_thread", threadIds)
      : new Map();

    // Augment threads with media
    const augmentedThreads = (threads || []).map((thread) => ({
      ...thread,
      media: mediaMap.get(thread.id) ?? [],
    }));

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    return NextResponse.json(
      {
        data: augmentedThreads,
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
      feature: "create discussion",
      limitPerIp: 15,
      limitPerUser: 5,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const bodySchema = z.object({
      orgId: baseSchemas.uuid,
      title: createThreadSchema.shape.title,
      body: createThreadSchema.shape.body,
      mediaIds: createThreadSchema.shape.mediaIds,
    });

    const { orgId, title, body, mediaIds } = await validateJson(request, bodySchema);

    // Check org membership
    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    // Fetch configurable discussion posting roles from the org
    const { data: org } = await supabase
      .from("organizations")
      .select("discussion_post_roles")
      .eq("id", orgId)
      .maybeSingle();

    const allowedRoles = (org as Record<string, unknown> | null)?.discussion_post_roles as string[] || ["admin", "active_member", "alumni"];
    if (!allowedRoles.includes(membership.role)) {
      return NextResponse.json({ error: "You do not have permission to create discussions" }, { status: 403 });
    }

    // Get author name for notification
    const { data: authorUser } = await supabase
      .from("users")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();

    // Create thread
    const { data: thread, error } = await supabase
      .from("discussion_threads")
      .insert({
        organization_id: orgId,
        author_id: user.id,
        title,
        body,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to create thread" }, { status: 500 });
    }

    // Link media attachments if provided
    if (mediaIds && mediaIds.length > 0) {
      const serviceClient = createServiceClient();
      const linkResult = await linkMediaToEntity(serviceClient, {
        mediaIds,
        entityType: "discussion_thread",
        entityId: thread.id,
        orgId,
        userId: user.id,
      });
      if (linkResult.error) {
        // Clean up orphaned thread to prevent duplicates on retry
        await serviceClient.from("discussion_threads").update({ deleted_at: new Date().toISOString() }).eq("id", thread.id);
        return NextResponse.json({ error: linkResult.error }, { status: 400, headers: rateLimit.headers });
      }
    }

    // Send notifications (fire-and-forget, don't block response)
    notifyNewThread({
      supabase,
      organizationId: orgId,
      threadTitle: title,
      threadUrl: `/discussions/${thread.id}`,
      authorName: authorUser?.name || "A member",
    }).catch(() => {
      // Notification failure should not affect thread creation
    });

    return NextResponse.json({ data: thread }, { status: 201, headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
