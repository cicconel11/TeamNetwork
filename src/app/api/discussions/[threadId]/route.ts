import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createThreadSchema } from "@/lib/schemas/discussion";
import { validateJson, validationErrorResponse, ValidationError } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { z } from "zod";

export async function GET(request: NextRequest, { params }: { params: { threadId: string } }) {
  try {
    // Rate limit check BEFORE auth
    const rateLimit = checkRateLimit(request, {
      feature: "discussion detail",
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

    const { threadId } = params;

    // Fetch thread
    const { data: thread, error: threadError } = await supabase
      .from("discussion_threads")
      .select(
        `
        *,
        author:users!discussion_threads_author_id_fkey(name)
      `,
      )
      .eq("id", threadId)
      .is("deleted_at", null)
      .maybeSingle();

    if (threadError) {
      return NextResponse.json({ error: "Failed to fetch thread" }, { status: 500 });
    }

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Check org membership
    const membership = await getOrgMembership(supabase, user.id, thread.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    // Fetch replies
    const { data: replies, error: repliesError } = await supabase
      .from("discussion_replies")
      .select(
        `
        *,
        author:users!discussion_replies_author_id_fkey(name)
      `,
      )
      .eq("thread_id", threadId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (repliesError) {
      return NextResponse.json({ error: "Failed to fetch replies" }, { status: 500 });
    }

    return NextResponse.json(
      {
        data: {
          thread,
          replies: replies || [],
        },
      },
      { headers: rateLimit.headers },
    );
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { threadId: string } }) {
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
      feature: "update discussion",
      limitPerIp: 30,
      limitPerUser: 15,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const { threadId } = params;

    const updateSchema = z.object({
      title: createThreadSchema.shape.title.optional(),
      body: createThreadSchema.shape.body.optional(),
      is_pinned: z.boolean().optional(),
      is_locked: z.boolean().optional(),
    });

    const updates = await validateJson(request, updateSchema);

    // Fetch thread
    const { data: thread } = await supabase
      .from("discussion_threads")
      .select("author_id, organization_id")
      .eq("id", threadId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Check if user is author or admin
    const membership = await getOrgMembership(supabase, user.id, thread.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";
    const isAuthor = thread.author_id === user.id;

    // Only author or admin can edit title/body
    if ((updates.title || updates.body) && !isAuthor && !isAdmin) {
      return NextResponse.json({ error: "Only the author or admin can edit this thread" }, { status: 403 });
    }

    // Only admin can pin/lock
    if ((updates.is_pinned !== undefined || updates.is_locked !== undefined) && !isAdmin) {
      return NextResponse.json({ error: "Only admins can pin or lock threads" }, { status: 403 });
    }

    // Update thread
    const { data: updatedThread, error } = await supabase
      .from("discussion_threads")
      .update(updates)
      .eq("id", threadId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to update thread" }, { status: 500 });
    }

    return NextResponse.json({ data: updatedThread }, { headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { threadId: string } }) {
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
      feature: "delete discussion",
      limitPerIp: 30,
      limitPerUser: 15,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const { threadId } = params;

    // Fetch thread
    const { data: thread } = await supabase
      .from("discussion_threads")
      .select("author_id, organization_id")
      .eq("id", threadId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Check if user is author or admin
    const membership = await getOrgMembership(supabase, user.id, thread.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const isAdmin = membership.role === "admin";
    const isAuthor = thread.author_id === user.id;

    if (!isAuthor && !isAdmin) {
      return NextResponse.json({ error: "Only the author or admin can delete this thread" }, { status: 403 });
    }

    // Soft delete
    const { error } = await supabase
      .from("discussion_threads")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", threadId);

    if (error) {
      return NextResponse.json({ error: "Failed to delete thread" }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { headers: rateLimit.headers });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
