import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas, validateJson, ValidationError } from "@/lib/security/validation";
import { voteSchema } from "@/lib/schemas/chat-polls";
import type { PollMetadata } from "@/lib/schemas/chat-polls";
import { getChatGroupContext } from "@/lib/auth/chat-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ groupId: string; messageId: string }>;
}

/**
 * POST /api/chat/[groupId]/polls/[messageId]/votes
 * Cast or change a vote on a poll.
 * Auth: must be active org member + group member.
 * Body: { option_index }
 */
export async function POST(req: Request, { params }: RouteParams) {
  const { groupId, messageId } = await params;

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
    feature: "chat-poll-vote",
    limitPerIp: 30,
    limitPerUser: 20,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) return respond({ error: "Unauthorized" }, 401);

  let parsed;
  try {
    parsed = await validateJson(req, voteSchema);
  } catch (err) {
    if (err instanceof ValidationError) {
      return respond({ error: err.message, details: err.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const ctx = await getChatGroupContext(supabase, user.id, groupId);
  if (!ctx.ok) return respond({ error: ctx.error }, ctx.status);

  if (!ctx.membership) {
    return respond({ error: "Forbidden" }, 403);
  }

  // Fetch the poll message
  const { data: pollMessage, error: messageError } = await supabase
    .from("chat_messages")
    .select("id, author_id, message_type, metadata, status, deleted_at")
    .eq("id", messageId)
    .eq("chat_group_id", groupId)
    .single();

  if (messageError || !pollMessage) {
    return respond({ error: "Poll not found" }, 404);
  }

  if (pollMessage.deleted_at !== null) {
    return respond({ error: "Poll has been deleted" }, 404);
  }

  if (pollMessage.message_type !== "poll") {
    return respond({ error: "Message is not a poll" }, 400);
  }

  // Determine if user can access non-approved polls
  const isAuthor = pollMessage.author_id === user.id;

  if (pollMessage.status !== "approved" && !isAuthor && !ctx.canModerate) {
    return respond({ error: "Poll is not yet approved" }, 403);
  }

  // Validate option_index is within bounds of available options
  const pollMetadata = pollMessage.metadata as PollMetadata | null;
  if (!pollMetadata || !Array.isArray(pollMetadata.options)) {
    return respond({ error: "Poll metadata is invalid" }, 500);
  }

  if (parsed.option_index >= pollMetadata.options.length) {
    return respond(
      { error: `option_index out of bounds (poll has ${pollMetadata.options.length} options)` },
      400
    );
  }

  // When allow_change is false, use INSERT to enforce single-vote immutability.
  // A unique violation (23505) means the user already voted.
  if (pollMetadata.allow_change === false) {
    const { data: vote, error: insertError } = await supabase
      .from("chat_poll_votes")
      .insert({
        message_id: messageId,
        chat_group_id: groupId,
        organization_id: ctx.group.organization_id,
        user_id: user.id,
        option_index: parsed.option_index,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return respond({ error: "Vote cannot be changed for this poll" }, 409);
      }
      return respond({ error: "Failed to cast vote" }, 500);
    }

    return respond({ vote });
  }

  // allow_change is true/null/missing — upsert as before
  const { data: vote, error: voteError } = await supabase
    .from("chat_poll_votes")
    .upsert(
      {
        message_id: messageId,
        chat_group_id: groupId,
        organization_id: ctx.group.organization_id,
        user_id: user.id,
        option_index: parsed.option_index,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "message_id,user_id" }
    )
    .select()
    .single();

  if (voteError) {
    return respond({ error: "Failed to cast vote" }, 500);
  }

  return respond({ vote });
}

/**
 * DELETE /api/chat/[groupId]/polls/[messageId]/votes
 * Retract the current user's vote on a poll.
 * Auth: must be active org member + group member.
 */
export async function DELETE(req: Request, { params }: RouteParams) {
  const { groupId, messageId } = await params;

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
    feature: "chat-poll-vote-retract",
    limitPerIp: 30,
    limitPerUser: 20,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) return respond({ error: "Unauthorized" }, 401);

  const ctx = await getChatGroupContext(supabase, user.id, groupId);
  if (!ctx.ok) return respond({ error: ctx.error }, ctx.status);

  if (!ctx.membership) {
    return respond({ error: "Forbidden" }, 403);
  }

  // Validate the poll message exists, belongs to this group, and is not deleted
  const { data: pollMessage } = await supabase
    .from("chat_messages")
    .select("id, message_type, metadata, deleted_at")
    .eq("id", messageId)
    .eq("chat_group_id", groupId)
    .single();

  if (!pollMessage || pollMessage.deleted_at !== null) {
    return respond({ error: "Poll not found" }, 404);
  }

  if (pollMessage.message_type !== "poll") {
    return respond({ error: "Message is not a poll" }, 400);
  }

  // Block retraction when allow_change is explicitly false
  const pollMetadata = pollMessage.metadata as PollMetadata | null;
  if (pollMetadata?.allow_change === false) {
    return respond({ error: "Vote cannot be retracted for this poll" }, 403);
  }

  // Delete the vote for this user on this message (scoped to group)
  const { error: deleteError } = await supabase
    .from("chat_poll_votes")
    .delete()
    .eq("message_id", messageId)
    .eq("chat_group_id", groupId)
    .eq("user_id", user.id);

  if (deleteError) {
    return respond({ error: "Failed to retract vote" }, 500);
  }

  return respond({ retracted: true });
}
