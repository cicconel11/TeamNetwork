import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { ChatMessagePane } from "@/components/messages/ChatMessagePane";
import type { ChatGroup, ChatGroupMember, User } from "@/types/database";

interface ChatGroupPageProps {
  params: Promise<{ orgSlug: string; groupId: string }>;
}

export default async function MessagesGroupPage({ params }: ChatGroupPageProps) {
  const { orgSlug, groupId } = await params;

  // Stage 1: org context (cached per request) + chat group (independent)
  const supabase = await createClient();
  const [orgCtx, { data: group, error: groupError }] = await Promise.all([
    getOrgContext(orgSlug),
    supabase
      .from("chat_groups")
      .select("*")
      .eq("id", groupId)
      .is("deleted_at", null)
      .single(),
  ]);

  if (!orgCtx.organization || !orgCtx.userId) return notFound();
  if (!group || groupError) return notFound();
  if (group.organization_id !== orgCtx.organization.id) return notFound();

  // Stage 2: membership check, members list, userInfo — all independent, all need userId/groupId
  const [{ data: membership, error: membershipError }, { data: members, error: membersError }, { data: userInfo }] = await Promise.all([
    supabase
      .from("chat_group_members")
      .select("*")
      .eq("chat_group_id", groupId)
      .eq("user_id", orgCtx.userId)
      .is("removed_at", null)
      .single(),
    supabase
      .from("chat_group_members")
      .select(`*, users:user_id (id, name, email, avatar_url)`)
      .eq("chat_group_id", groupId)
      .is("removed_at", null),
    supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .eq("id", orgCtx.userId)
      .single(),
  ]);

  if (membershipError && membershipError.code !== "PGRST116") {
    console.error("[chat-members] membership check failed:", membershipError);
  }

  if (membersError) {
    console.error("[chat-members] failed to fetch members:", membersError);
  }

  const isModerator = membership?.role === "admin" || membership?.role === "moderator";
  const canModerate = orgCtx.isAdmin || isModerator;

  if (!membership && !orgCtx.isAdmin) return notFound();

  const isCreator = group.created_by === orgCtx.userId;

  return (
    <ChatMessagePane
      group={group as ChatGroup}
      orgSlug={orgSlug}
      organizationId={orgCtx.organization.id}
      currentUserId={orgCtx.userId}
      currentUser={userInfo as User}
      members={(members || []) as (ChatGroupMember & { users: User })[]}
      canModerate={canModerate}
      isCreator={isCreator}
      requiresApproval={group.require_approval}
      memberJoinedAt={membership?.joined_at}
    />
  );
}
