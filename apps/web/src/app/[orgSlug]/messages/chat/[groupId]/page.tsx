import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { isOrgAdmin, getCurrentUser } from "@/lib/auth";
import { ChatMessagePane } from "@/components/messages/ChatMessagePane";
import type { ChatGroup, ChatGroupMember, User } from "@/types/database";

interface ChatGroupPageProps {
  params: Promise<{ orgSlug: string; groupId: string }>;
}

export default async function MessagesGroupPage({ params }: ChatGroupPageProps) {
  const { orgSlug, groupId } = await params;
  const supabase = await createClient();

  // Fetch organization
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .limit(1);

  const org = orgs?.[0];
  if (!org || orgError) return notFound();

  // Fetch chat group
  const { data: group, error: groupError } = await supabase
    .from("chat_groups")
    .select("*")
    .eq("id", groupId)
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .single();

  if (!group || groupError) return notFound();

  const currentUser = await getCurrentUser();
  if (!currentUser) return notFound();

  const { data: membership, error: membershipError } = await supabase
    .from("chat_group_members")
    .select("*")
    .eq("chat_group_id", groupId)
    .eq("user_id", currentUser.id)
    .is("removed_at", null)
    .single();

  if (membershipError && membershipError.code !== "PGRST116") {
    console.error("[chat-members] membership check failed:", membershipError);
  }

  const isAdmin = await isOrgAdmin(org.id);
  const isModerator = membership?.role === "admin" || membership?.role === "moderator";
  const canModerate = isAdmin || isModerator;

  if (!membership && !isAdmin) return notFound();

  const isCreator = group.created_by === currentUser.id;

  const { data: members, error: membersError } = await supabase
    .from("chat_group_members")
    .select(`*, users:user_id (id, name, email, avatar_url)`)
    .eq("chat_group_id", groupId)
    .is("removed_at", null);

  if (membersError) {
    console.error("[chat-members] failed to fetch members:", membersError);
  }

  const { data: userInfo } = await supabase
    .from("users")
    .select("id, name, email, avatar_url")
    .eq("id", currentUser.id)
    .single();

  return (
    <ChatMessagePane
      group={group as ChatGroup}
      orgSlug={orgSlug}
      organizationId={org.id}
      currentUserId={currentUser.id}
      currentUser={userInfo as User}
      members={(members || []) as (ChatGroupMember & { users: User })[]}
      canModerate={canModerate}
      isCreator={isCreator}
      requiresApproval={group.require_approval}
      memberJoinedAt={membership?.joined_at}
    />
  );
}
