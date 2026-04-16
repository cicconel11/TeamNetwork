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

type MessageAccessResult =
  | { ok: true; threadId: string }
  | { ok: false; response: NextResponse };

async function resolveAccessibleMessageThread(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  messageId: string;
  orgId: string;
  userId: string;
  headers: HeadersInit;
}): Promise<MessageAccessResult> {
  const { supabase, messageId, orgId, userId, headers } = input;

  const { data: message, error: messageError } = await supabase
    .from("ai_messages")
    .select("id, thread_id")
    .eq("id", messageId)
    .single();

  if (messageError || !message) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Message not found" },
        { status: 404, headers }
      ),
    };
  }

  const { data: thread, error: threadError } = await supabase
    .from("ai_threads")
    .select("id, user_id, org_id")
    .eq("id", message.thread_id)
    .single();

  if (threadError || !thread) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Thread not found" },
        { status: 404, headers }
      ),
    };
  }

  if (thread.user_id !== userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Not authorized" },
        { status: 403, headers }
      ),
    };
  }

  if (thread.org_id !== orgId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Thread does not belong to this organization" },
        { status: 403, headers }
      ),
    };
  }

  return { ok: true, threadId: message.thread_id };
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

    const messageAccess = await resolveAccessibleMessageThread({
      supabase: ctx.supabase,
      messageId,
      orgId,
      userId: ctx.userId,
      headers: rateLimit.headers,
    });
    if (!messageAccess.ok) return messageAccess.response;

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

    const url = new URL(request.url);
    const messageId = url.searchParams.get("messageId");
    const messageIds = url.searchParams.get("messageIds");

    // Batch mode: ?messageIds=id1,id2,id3
    if (messageIds) {
      const ids = Array.from(new Set(messageIds.split(",").filter(Boolean))).slice(0, 100);
      if (ids.length === 0) {
        return NextResponse.json(
          { error: "messageIds cannot be empty" },
          { status: 400, headers: rateLimit.headers }
        );
      }

      for (const id of ids) {
        const messageAccess = await resolveAccessibleMessageThread({
          supabase: ctx.supabase,
          messageId: id,
          orgId,
          userId: ctx.userId,
          headers: rateLimit.headers,
        });
        if (!messageAccess.ok) return messageAccess.response;
      }

      const { data: feedbackList, error } = await ctx.supabase
        .from("ai_feedback")
        .select("id, message_id, rating, comment, created_at")
        .in("message_id", ids)
        .eq("user_id", ctx.userId);

      if (error) {
        console.error("[ai-feedback] batch get error:", error);
        return NextResponse.json(
          { error: "Failed to get feedback" },
          { status: 500, headers: rateLimit.headers }
        );
      }

      return NextResponse.json(
        { data: feedbackList ?? [] },
        { status: 200, headers: rateLimit.headers }
      );
    }

    // Single mode: ?messageId=id (backward compatible)
    if (!messageId) {
      return NextResponse.json(
        { error: "messageId or messageIds is required" },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const messageAccess = await resolveAccessibleMessageThread({
      supabase: ctx.supabase,
      messageId,
      orgId,
      userId: ctx.userId,
      headers: rateLimit.headers,
    });
    if (!messageAccess.ok) return messageAccess.response;

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

export function createAiFeedbackDeleteHandler(deps: AiFeedbackRouteDeps = {}) {
  const createClientFn = deps.createClient ?? createClient;
  const getAiOrgContextFn = deps.getAiOrgContext ?? getAiOrgContext;

  return async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
  ) {
    const { orgId } = await params;

    const rateLimit = checkRateLimit(request, {
      feature: "AI feedback",
      limitPerIp: 60,
      limitPerUser: 60,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    const supabase = await createClientFn();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const ctx = await getAiOrgContextFn(orgId, user, rateLimit, { supabase });
    if (!ctx.ok) return ctx.response;

    const url = new URL(request.url);
    const messageId = url.searchParams.get("messageId");

    if (!messageId) {
      return NextResponse.json(
        { error: "messageId is required" },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const messageAccess = await resolveAccessibleMessageThread({
      supabase: ctx.supabase,
      messageId,
      orgId,
      userId: ctx.userId,
      headers: rateLimit.headers,
    });
    if (!messageAccess.ok) return messageAccess.response;

    const { error } = await ctx.supabase
      .from("ai_feedback")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", ctx.userId);

    if (error) {
      console.error("[ai-feedback] delete error:", error);
      return NextResponse.json(
        { error: "Failed to delete feedback" },
        { status: 500, headers: rateLimit.headers }
      );
    }

    return NextResponse.json(
      { success: true },
      { status: 200, headers: rateLimit.headers }
    );
  };
}
