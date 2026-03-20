import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import { resolveOwnThread } from "@/lib/ai/thread-resolver";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; threadId: string }> }
) {
  const { orgId, threadId } = await params;

  // Rate limit before touching the DB
  const rateLimit = checkRateLimit(request, {
    feature: "AI messages list",
    limitPerIp: 30,
    limitPerUser: 30,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  // Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ctx = await getAiOrgContext(orgId, user, rateLimit, { supabase });
  if (!ctx.ok) return ctx.response;

  // Resolve ownership via service client
  const resolution = await resolveOwnThread(
    threadId,
    ctx.userId,
    ctx.orgId,
    ctx.serviceSupabase
  );
  if (!resolution.ok) {
    return NextResponse.json(
      { error: resolution.message },
      { status: resolution.status }
    );
  }

  // Query messages via auth-bound client (RLS enforces thread ownership)
  const { data: messages, error } = await ctx.supabase
    .from("ai_messages")
    .select("id, role, content, intent, status, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[ai-messages] list error:", error);
    return NextResponse.json({ error: "Failed to list messages" }, { status: 500 });
  }

  return NextResponse.json({ messages });
}
