import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas, validateJson, ValidationError } from "@/lib/security/validation";
import { addChatMembersSchema, removeChatMemberSchema } from "@/lib/schemas/chat";
import { getChatGroupContext } from "@/lib/auth/chat-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ groupId: string }>;
}

/**
 * GET /api/chat/[groupId]/members
 * List current members of the group with user info.
 * Auth: must be active org member + (group member OR org admin).
 */
export async function GET(_req: Request, { params }: RouteParams) {
  const { groupId } = await params;

  const groupIdParsed = baseSchemas.uuid.safeParse(groupId);
  if (!groupIdParsed.success) {
    return NextResponse.json({ error: "Invalid group id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(_req, {
    userId: user?.id ?? null,
    feature: "chat-members-list",
    limitPerIp: 30,
    limitPerUser: 20,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) return respond({ error: "Unauthorized" }, 401);

  const ctx = await getChatGroupContext(supabase, user.id, groupId);
  if (!ctx.ok) return respond({ error: ctx.error }, ctx.status);

  // Fetch all members with user info
  const { data: members, error: membersError } = await supabase
    .from("chat_group_members")
    .select(`
      id, user_id, role, joined_at,
      users:user_id (id, name, email, avatar_url)
    `)
    .eq("chat_group_id", groupId)
    .is("removed_at", null);

  if (membersError) {
    return respond({ error: "Failed to load members" }, 500);
  }

  return respond({ members: members || [] });
}

/**
 * POST /api/chat/[groupId]/members
 * Add member(s) to the group.
 * Auth: must be org admin OR group admin/moderator.
 * Body: { user_ids: string[] }
 */
export async function POST(req: Request, { params }: RouteParams) {
  const { groupId } = await params;

  const groupIdParsed = baseSchemas.uuid.safeParse(groupId);
  if (!groupIdParsed.success) {
    return NextResponse.json({ error: "Invalid group id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "chat-members-add",
    limitPerIp: 20,
    limitPerUser: 10,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) return respond({ error: "Unauthorized" }, 401);

  let parsedBody;
  try {
    parsedBody = await validateJson(req, addChatMembersSchema);
  } catch (err) {
    if (err instanceof ValidationError) {
      return respond({ error: err.message, details: err.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const { user_ids } = parsedBody;

  const ctx = await getChatGroupContext(supabase, user.id, groupId);
  if (!ctx.ok) return respond({ error: ctx.error }, ctx.status);

  if (!ctx.isOrgAdmin && !ctx.isGroupMod) {
    return respond({ error: "Forbidden" }, 403);
  }

  // Validate all user_ids are active org members
  const { data: activeMembers } = await supabase
    .from("members")
    .select("user_id")
    .eq("organization_id", ctx.group.organization_id)
    .eq("status", "active")
    .is("deleted_at", null)
    .in("user_id", user_ids);

  const activeUserIds = new Set((activeMembers || []).map(m => m.user_id));
  const invalidIds = user_ids.filter(id => !activeUserIds.has(id));
  if (invalidIds.length > 0) {
    return respond({ error: "Some users are not active org members", invalid_ids: invalidIds }, 400);
  }

  // Check which users are already ACTIVE group members
  const { data: existingMembers } = await supabase
    .from("chat_group_members")
    .select("user_id")
    .eq("chat_group_id", groupId)
    .is("removed_at", null)
    .in("user_id", user_ids);

  const existingIds = new Set((existingMembers || []).map(m => m.user_id));

  // Check for soft-deleted rows that can be reactivated
  const { data: removedMembers } = await supabase
    .from("chat_group_members")
    .select("user_id")
    .eq("chat_group_id", groupId)
    .not("removed_at", "is", null)
    .in("user_id", user_ids);

  const removedIds = new Set((removedMembers || []).map(m => m.user_id));

  // Reactivate soft-deleted members
  const toReactivate = user_ids.filter(id => !existingIds.has(id) && removedIds.has(id));
  if (toReactivate.length > 0) {
    await supabase
      .from("chat_group_members")
      .update({ removed_at: null })
      .eq("chat_group_id", groupId)
      .in("user_id", toReactivate);
  }

  // Insert truly new members
  const newUserIds = user_ids.filter(id => !existingIds.has(id) && !removedIds.has(id));
  if (newUserIds.length > 0) {
    const inserts = newUserIds.map(uid => ({
      chat_group_id: groupId,
      user_id: uid,
      organization_id: ctx.group.organization_id,
      role: "member" as const,
    }));

    const { error: insertError } = await supabase
      .from("chat_group_members")
      .insert(inserts);

    if (insertError) {
      return respond({ error: "Failed to add members" }, 500);
    }
  }

  return respond({
    added: toReactivate.length + newUserIds.length,
    skipped: existingIds.size,
  });
}

/**
 * DELETE /api/chat/[groupId]/members
 * Remove a member from the group.
 * Auth: org admin, group admin/moderator, OR self (leaving).
 * Body: { user_id: string }
 */
export async function DELETE(req: Request, { params }: RouteParams) {
  const { groupId } = await params;

  const groupIdParsed = baseSchemas.uuid.safeParse(groupId);
  if (!groupIdParsed.success) {
    return NextResponse.json({ error: "Invalid group id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "chat-members-remove",
    limitPerIp: 20,
    limitPerUser: 10,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) return respond({ error: "Unauthorized" }, 401);

  let parsedBody;
  try {
    parsedBody = await validateJson(req, removeChatMemberSchema);
  } catch (err) {
    if (err instanceof ValidationError) {
      return respond({ error: err.message, details: err.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const { user_id: targetUserId } = parsedBody;

  const ctx = await getChatGroupContext(supabase, user.id, groupId);
  if (!ctx.ok) return respond({ error: ctx.error }, ctx.status);

  const isSelf = user.id === targetUserId;

  // Authorization: org admin, group admin/moderator, or self
  if (!ctx.isOrgAdmin && !ctx.isGroupMod && !isSelf) {
    return respond({ error: "Forbidden" }, 403);
  }

  // Check that the target is actually a group member
  const { data: targetMembership } = await supabase
    .from("chat_group_members")
    .select("id, role, joined_at")
    .eq("chat_group_id", groupId)
    .eq("user_id", targetUserId)
    .is("removed_at", null)
    .maybeSingle();

  if (!targetMembership) {
    return respond({ error: "User is not a member of this group" }, 404);
  }

  // Prevent removing the last group admin
  if (targetMembership.role === "admin") {
    const { data: adminMembers } = await supabase
      .from("chat_group_members")
      .select("id")
      .eq("chat_group_id", groupId)
      .eq("role", "admin")
      .is("removed_at", null);

    if ((adminMembers || []).length <= 1) {
      return respond({ error: "Cannot remove the last group admin" }, 400);
    }
  }

  // Soft-delete the membership
  const { error: deleteError } = await supabase
    .from("chat_group_members")
    .update({ removed_at: new Date().toISOString() })
    .eq("chat_group_id", groupId)
    .eq("user_id", targetUserId);

  if (deleteError) {
    return respond({ error: "Failed to remove member" }, 500);
  }

  return respond({ removed: true });
}
