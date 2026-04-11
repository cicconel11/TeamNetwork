import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas, safeString, validateJson, ValidationError } from "@/lib/security/validation";
import { getChatGroupContext } from "@/lib/auth/chat-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ groupId: string }>;
}

const sendMessageSchema = z.object({
  body: safeString(4000),
});
type SendMessageBody = z.infer<typeof sendMessageSchema>;

/**
 * POST /api/chat/[groupId]/messages
 * Send a text message in the chat group.
 * Auth: active org role + (group member OR org admin).
 * Body: { body: string }
 */
export async function POST(req: Request, { params }: RouteParams) {
  const { groupId } = await params;

  const groupIdParsed = baseSchemas.uuid.safeParse(groupId);
  if (!groupIdParsed.success) {
    return NextResponse.json({ error: "Invalid group id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "chat-message-send",
    limitPerIp: 60,
    limitPerUser: 40,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) return respond({ error: "Unauthorized" }, 401);

  let parsed: SendMessageBody;
  try {
    parsed = await validateJson(req, sendMessageSchema);
  } catch (err) {
    if (err instanceof ValidationError) {
      return respond({ error: err.message, details: err.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const ctx = await getChatGroupContext(supabase, user.id, groupId);
  if (!ctx.ok) return respond({ error: ctx.error }, ctx.status);

  const status = ctx.group.require_approval && !ctx.canModerate ? "pending" : "approved";

  const { data: message, error: insertError } = await supabase
    .from("chat_messages")
    .insert({
      chat_group_id: groupId,
      organization_id: ctx.group.organization_id,
      author_id: user.id,
      body: parsed.body,
      status,
    })
    .select()
    .single();

  if (insertError) {
    return respond({ error: "Failed to send message" }, 500);
  }

  return respond({ message }, 201);
}
