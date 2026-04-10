import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { getOrgMembership } from "@/lib/auth/api-helpers";

export async function POST(request: NextRequest, { params }: { params: { threadId: string; replyId: string } }) {
  try {
    const { threadId, replyId } = params;
    const threadIdParsed = baseSchemas.uuid.safeParse(threadId);
    const replyIdParsed = baseSchemas.uuid.safeParse(replyId);

    if (!threadIdParsed.success || !replyIdParsed.success) {
      return NextResponse.json({ error: "Invalid identifier" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      feature: "toggle discussion reply like",
      limitPerIp: 60,
      limitPerUser: 30,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const { data: reply } = await supabase
      .from("discussion_replies")
      .select("id, organization_id, thread_id")
      .eq("id", replyId)
      .eq("thread_id", threadId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!reply) {
      return NextResponse.json({ error: "Reply not found" }, { status: 404 });
    }

    const membership = await getOrgMembership(supabase, user.id, reply.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const { data: existingLike } = await supabase
      .from("discussion_reply_likes")
      .select("id")
      .eq("reply_id", replyId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingLike) {
      const { error } = await supabase
        .from("discussion_reply_likes")
        .delete()
        .eq("id", existingLike.id);

      if (error) {
        return NextResponse.json({ error: "Failed to unlike reply" }, { status: 500 });
      }

      return NextResponse.json({ data: { liked: false } }, { headers: rateLimit.headers });
    }

    const { error } = await supabase
      .from("discussion_reply_likes")
      .insert({
        reply_id: replyId,
        thread_id: threadId,
        organization_id: reply.organization_id,
        user_id: user.id,
      });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ data: { liked: true } }, { headers: rateLimit.headers });
      }
      return NextResponse.json({ error: "Failed to like reply" }, { status: 500 });
    }

    return NextResponse.json({ data: { liked: true } }, { headers: rateLimit.headers });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
