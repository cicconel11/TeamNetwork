import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { voteSchema } from "@/lib/schemas/chat-polls";
import type { PollMetadata } from "@/lib/schemas/chat-polls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ groupId: string; messageId: string }>;
}

/**
 * Loads the chat group and validates it exists and is not soft-deleted.
 * Also selects require_approval to determine message status.
 * Returns the group or null.
 */
async function loadGroup(supabase: Awaited<ReturnType<typeof createClient>>, groupId: string) {
  const { data } = await supabase
    .from("chat_groups")
    .select("id, organization_id, require_approval, deleted_at")
    .eq("id", groupId)
    .is("deleted_at", null)
    .single();
  return data;
}

/**
 * Checks if a user is a member of the chat group and returns their membership row.
 */
async function getGroupMembership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupId: string,
  userId: string
) {
  const { data } = await supabase
    .from("chat_group_members")
    .select("id, role, joined_at")
    .eq("chat_group_id", groupId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();
  return data;
}

/**
 * POST /api/chat/[groupId]/polls/[messageId]/votes
 * Cast or change a vote on a poll.
 * Auth: must be group member.
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

  // Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return respond({ error: "Invalid JSON body" }, 400);
  }

  const parsed = voteSchema.safeParse(body);
  if (!parsed.success) {
    return respond({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }

  const group = await loadGroup(supabase, groupId);
  if (!group) return respond({ error: "Group not found" }, 404);

  // Check org membership and role
  const { data: orgRole } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", group.organization_id)
    .maybeSingle();

  if (!orgRole) return respond({ error: "Forbidden" }, 403);

  const isOrgAdmin = orgRole.role === "admin";
  const membership = await getGroupMembership(supabase, groupId, user.id);

  if (!membership && !isOrgAdmin) {
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
  const isGroupMod = membership?.role === "admin" || membership?.role === "moderator";
  const canModerate = isOrgAdmin || isGroupMod;
  const isAuthor = pollMessage.author_id === user.id;

  if (pollMessage.status !== "approved" && !isAuthor && !canModerate) {
    return respond({ error: "Poll is not yet approved" }, 403);
  }

  // Validate option_index is within bounds of available options
  const pollMetadata = pollMessage.metadata as PollMetadata | null;
  if (!pollMetadata || !Array.isArray(pollMetadata.options)) {
    return respond({ error: "Poll metadata is invalid" }, 500);
  }

  if (parsed.data.option_index >= pollMetadata.options.length) {
    return respond(
      { error: `option_index out of bounds (poll has ${pollMetadata.options.length} options)` },
      400
    );
  }

  // Upsert the vote - on conflict of (message_id, user_id), update option_index and updated_at
  const { data: vote, error: voteError } = await supabase
    .from("chat_poll_votes")
    .upsert(
      {
        message_id: messageId,
        chat_group_id: groupId,
        organization_id: group.organization_id,
        user_id: user.id,
        option_index: parsed.data.option_index,
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
 * Auth: must be group member.
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

  const group = await loadGroup(supabase, groupId);
  if (!group) return respond({ error: "Group not found" }, 404);

  // Check org membership and group membership
  const { data: orgRole } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", group.organization_id)
    .maybeSingle();

  if (!orgRole) return respond({ error: "Forbidden" }, 403);

  const isOrgAdmin = orgRole.role === "admin";
  const membership = await getGroupMembership(supabase, groupId, user.id);

  if (!membership && !isOrgAdmin) {
    return respond({ error: "Forbidden" }, 403);
  }

  // Delete the vote for this user on this message
  const { error: deleteError } = await supabase
    .from("chat_poll_votes")
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", user.id);

  if (deleteError) {
    return respond({ error: "Failed to retract vote" }, 500);
  }

  return respond({ retracted: true });
}
