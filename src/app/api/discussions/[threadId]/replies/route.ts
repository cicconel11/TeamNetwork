import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateJson, validationErrorResponse, ValidationError } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { createReplySchema } from "@/lib/schemas/discussion";
import { createDiscussionReply } from "@/lib/discussions/create-reply";

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

    const result = await createDiscussionReply({
      supabase,
      threadId,
      userId: user.id,
      input: { body },
    });

    if (!result.ok) {
      return NextResponse.json(
        result.details ? { error: result.error, details: result.details } : { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({ data: result.reply }, { status: 201, headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
