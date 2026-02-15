import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createReplySchema } from "@/lib/schemas/discussion";
import { validateJson, validationErrorResponse, ValidationError } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";

export async function POST(request: NextRequest, { params }: { params: { threadId: string } }) {
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
      feature: "create reply",
      limitPerIp: 15,
      limitPerUser: 8,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const { threadId } = params;
    const { body } = await validateJson(request, createReplySchema);

    // Fetch thread to check if locked and get org_id
    const { data: thread } = await supabase
      .from("discussion_threads")
      .select("organization_id, is_locked")
      .eq("id", threadId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    if (thread.is_locked) {
      return NextResponse.json({ error: "Thread is locked" }, { status: 403 });
    }

    // Check org membership
    const membership = await getOrgMembership(supabase, user.id, thread.organization_id);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    // Create reply
    const { data: reply, error } = await supabase
      .from("discussion_replies")
      .insert({
        thread_id: threadId,
        organization_id: thread.organization_id,
        author_id: user.id,
        body,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to create reply" }, { status: 500 });
    }

    return NextResponse.json({ data: reply }, { status: 201, headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
