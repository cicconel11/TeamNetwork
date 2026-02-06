import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { addChatMembersSchema, removeChatMemberSchema } from "@/lib/schemas/chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ groupId: string }>;
}

/**
 * Loads the chat group and validates it exists and is not soft-deleted.
 * Returns the group or null.
 */
async function loadGroup(supabase: Awaited<ReturnType<typeof createClient>>, groupId: string) {
  const { data } = await supabase
    .from("chat_groups")
    .select("id, organization_id, deleted_at")
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
 * GET /api/chat/[groupId]/members
 * List current members of the group with user info.
 * Auth: must be group member OR org admin.
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

  const group = await loadGroup(supabase, groupId);
  if (!group) return respond({ error: "Group not found" }, 404);

  // Check org membership
  const { data: orgRole } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", group.organization_id)
    .maybeSingle();

  if (!orgRole) return respond({ error: "Forbidden" }, 403);

  const isAdmin = orgRole.role === "admin";
  const membership = await getGroupMembership(supabase, groupId, user.id);

  if (!membership && !isAdmin) {
    return respond({ error: "Forbidden" }, 403);
  }

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

  // Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return respond({ error: "Invalid JSON body" }, 400);
  }

  const parsed = addChatMembersSchema.safeParse(body);
  if (!parsed.success) {
    return respond({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }

  const { user_ids } = parsed.data;

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

  const isAdmin = orgRole.role === "admin";
  const membership = await getGroupMembership(supabase, groupId, user.id);
  const isGroupMod = membership?.role === "admin" || membership?.role === "moderator";

  if (!isAdmin && !isGroupMod) {
    return respond({ error: "Forbidden" }, 403);
  }

  // Validate all user_ids are active org members
  const { data: activeMembers } = await supabase
    .from("members")
    .select("user_id")
    .eq("organization_id", group.organization_id)
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
      organization_id: group.organization_id,
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

  // Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return respond({ error: "Invalid JSON body" }, 400);
  }

  const parsed = removeChatMemberSchema.safeParse(body);
  if (!parsed.success) {
    return respond({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }

  const { user_id: targetUserId } = parsed.data;

  const group = await loadGroup(supabase, groupId);
  if (!group) return respond({ error: "Group not found" }, 404);

  // Check org membership
  const { data: orgRole } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", group.organization_id)
    .maybeSingle();

  if (!orgRole) return respond({ error: "Forbidden" }, 403);

  const isAdmin = orgRole.role === "admin";
  const membership = await getGroupMembership(supabase, groupId, user.id);
  const isGroupMod = membership?.role === "admin" || membership?.role === "moderator";
  const isSelf = user.id === targetUserId;

  // Authorization: org admin, group admin/moderator, or self
  if (!isAdmin && !isGroupMod && !isSelf) {
    return respond({ error: "Forbidden" }, 403);
  }

  // Check that the target is actually a group member
  const targetMembership = await getGroupMembership(supabase, groupId, targetUserId);
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
