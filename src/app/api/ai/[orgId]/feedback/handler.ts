import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import { aiFeedbackSchema } from "@/lib/schemas";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError } from "@/lib/security/validation";

export interface AiFeedbackRouteDeps {
  createClient?: typeof createClient;
  getAiOrgContext?: typeof getAiOrgContext;
}

export function createAiFeedbackPostHandler(deps: AiFeedbackRouteDeps = {}) {
  const createClientFn = deps.createClient ?? createClient;
  const getAiOrgContextFn = deps.getAiOrgContext ?? getAiOrgContext;

  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
  ) {
    const { orgId } = await params;

    // Rate limit
    const rateLimit = checkRateLimit(request, {
      feature: "AI feedback",
      limitPerIp: 60,
      limitPerUser: 60,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    // Auth
    const supabase = await createClientFn();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const ctx = await getAiOrgContextFn(orgId, user, rateLimit, { supabase });
    if (!ctx.ok) return ctx.response;

    // Parse and validate body
    let messageId: string;
    let rating: "positive" | "negative";
    let comment: string | undefined;
    try {
      const body = await validateJson(request, aiFeedbackSchema);
      messageId = body.messageId;
      rating = body.rating;
      comment = body.comment;
    } catch (err) {
      if (err instanceof ValidationError) {
        return NextResponse.json(
          { error: err.message },
          { status: 400, headers: rateLimit.headers }
        );
      }
      throw err;
    }

    // Verify message exists and belongs to user's thread (RLS does this, but explicit check provides better error)
    const { data: message, error: messageError } = await ctx.supabase
      .from("ai_messages")
      .select("id, thread_id")
      .eq("id", messageId)
      .single();

    if (messageError || !message) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404, headers: rateLimit.headers }
      );
    }

    // Verify thread belongs to user and is in this org
    const { data: thread, error: threadError } = await ctx.supabase
      .from("ai_threads")
      .select("id, user_id, org_id")
      .eq("id", message.thread_id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404, headers: rateLimit.headers }
      );
    }

    if (thread.user_id !== ctx.userId) {
      return NextResponse.json(
        { error: "Not authorized" },
        { status: 403, headers: rateLimit.headers }
      );
    }

    if (thread.org_id !== orgId) {
      return NextResponse.json(
        { error: "Thread does not belong to this organization" },
        { status: 403, headers: rateLimit.headers }
      );
    }

    // Upsert feedback (unique constraint on message_id, user_id handles duplicates)
    const { data: feedback, error: feedbackError } = await ctx.supabase
      .from("ai_feedback")
      .upsert(
        {
          message_id: messageId,
          user_id: ctx.userId,
          rating,
          comment: comment ?? null,
        },
        { onConflict: "message_id,user_id" }
      )
      .select("id, message_id, rating, comment, created_at")
      .single();

    if (feedbackError) {
      console.error("[ai-feedback] upsert error:", feedbackError);
      return NextResponse.json(
        { error: "Failed to save feedback" },
        { status: 500, headers: rateLimit.headers }
      );
    }

    return NextResponse.json(
      { data: feedback },
      { status: 200, headers: rateLimit.headers }
    );
  };
}

export function createAiFeedbackGetHandler(deps: AiFeedbackRouteDeps = {}) {
  const createClientFn = deps.createClient ?? createClient;
  const getAiOrgContextFn = deps.getAiOrgContext ?? getAiOrgContext;

  return async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
  ) {
    const { orgId } = await params;

    // Rate limit
    const rateLimit = checkRateLimit(request, {
      feature: "AI feedback",
      limitPerIp: 60,
      limitPerUser: 60,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    // Auth
    const supabase = await createClientFn();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const ctx = await getAiOrgContextFn(orgId, user, rateLimit, { supabase });
    if (!ctx.ok) return ctx.response;

    // Get messageId from query params
    const url = new URL(request.url);
    const messageId = url.searchParams.get("messageId");

    if (!messageId) {
      return NextResponse.json(
        { error: "messageId is required" },
        { status: 400, headers: rateLimit.headers }
      );
    }

    // Get feedback for this message by this user (RLS handles ownership check)
    const { data: feedback, error } = await ctx.supabase
      .from("ai_feedback")
      .select("id, message_id, rating, comment, created_at")
      .eq("message_id", messageId)
      .eq("user_id", ctx.userId)
      .maybeSingle();

    if (error) {
      console.error("[ai-feedback] get error:", error);
      return NextResponse.json(
        { error: "Failed to get feedback" },
        { status: 500, headers: rateLimit.headers }
      );
    }

    return NextResponse.json(
      { data: feedback },
      { status: 200, headers: rateLimit.headers }
    );
  };
}
