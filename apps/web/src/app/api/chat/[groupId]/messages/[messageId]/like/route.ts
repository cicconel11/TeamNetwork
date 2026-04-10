import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { getChatGroupContext } from "@/lib/auth/chat-helpers";

export async function POST(req: Request, { params }: { params: { groupId: string; messageId: string } }) {
  const { groupId, messageId } = params;

  const groupIdParsed = baseSchemas.uuid.safeParse(groupId);
  if (!groupIdParsed.success) {
    return NextResponse.json({ error: "Invalid group id" }, { status: 400 });
  }

  const messageIdParsed = baseSchemas.uuid.safeParse(messageId);
  if (!messageIdParsed.success) {
    return NextResponse.json({ error: "Invalid message id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "toggle chat message like",
    limitPerIp: 60,
    limitPerUser: 30,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) return respond({ error: "Unauthorized" }, 401);

  const ctx = await getChatGroupContext(supabase, user.id, groupId);
  if (!ctx.ok) return respond({ error: ctx.error }, ctx.status);

  const { data: message } = await supabase
    .from("chat_messages")
    .select("id, organization_id, status, author_id, deleted_at")
    .eq("id", messageId)
    .eq("chat_group_id", groupId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!message) {
    return respond({ error: "Message not found" }, 404);
  }

  const isAuthor = message.author_id === user.id;
  if (message.status !== "approved" && !isAuthor && !ctx.canModerate) {
    return respond({ error: "Message is not available" }, 403);
  }

  const { data: existingLike } = await supabase
    .from("chat_message_likes")
    .select("id")
    .eq("message_id", messageId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingLike) {
    const { error } = await supabase
      .from("chat_message_likes")
      .delete()
      .eq("id", existingLike.id);

    if (error) {
      return respond({ error: "Failed to unlike message" }, 500);
    }

    return respond({ data: { liked: false } });
  }

  const { error } = await supabase
    .from("chat_message_likes")
    .insert({
      message_id: messageId,
      chat_group_id: groupId,
      organization_id: message.organization_id,
      user_id: user.id,
    });

  if (error) {
    if (error.code === "23505") {
      return respond({ data: { liked: true } });
    }
    return respond({ error: "Failed to like message" }, 500);
  }

  return respond({ data: { liked: true } });
}
