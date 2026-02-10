import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { isOrgAdmin } from "@/lib/auth";
import { ChatGroupCard } from "@/components/chat/ChatGroupCard";
import type { ChatGroup, ChatGroupMember } from "@/types/database";

interface ChatPageProps {
  params: Promise<{ orgSlug: string }>;
}

type ChatGroupWithMembers = ChatGroup & {
  chat_group_members: Pick<ChatGroupMember, "id" | "user_id" | "role" | "removed_at">[];
  _count?: { pending: number };
};

export default async function ChatPage({ params }: ChatPageProps) {
  const { orgSlug } = await params;
  const supabase = await createClient();

  // Fetch organization
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .limit(1);

  const org = orgs?.[0];
  if (!org || orgError) return null;

  const isAdmin = await isOrgAdmin(org.id);

  // Fetch chat groups user is a member of (or all if admin)
  const { data: groups } = await supabase
    .from("chat_groups")
    .select(`
      *,
      chat_group_members (id, user_id, role, removed_at)
    `)
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  const chatGroups = (groups || []) as ChatGroupWithMembers[];

  // For admins/mods, get pending message counts
  let pendingCounts: Record<string, number> = {};
  if (isAdmin) {
    const { data: pendingMessages } = await supabase
      .from("chat_messages")
      .select("chat_group_id")
      .eq("organization_id", org.id)
      .eq("status", "pending")
      .is("deleted_at", null);

    if (pendingMessages) {
      pendingCounts = pendingMessages.reduce((acc, msg) => {
        acc[msg.chat_group_id] = (acc[msg.chat_group_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
    }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Chat"
        description={`${chatGroups.length} group${chatGroups.length !== 1 ? "s" : ""}`}
        actions={
          isAdmin && (
            <Link href={`/${orgSlug}/chat/new`}>
              <Button>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                New Group
              </Button>
            </Link>
          )
        }
      />

      {chatGroups.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 stagger-children">
          {chatGroups.map((group) => {
            const pendingCount = pendingCounts[group.id] || 0;
            const memberCount =
              group.chat_group_members?.filter(
                (m: ChatGroupWithMembers["chat_group_members"][number]) => !m.removed_at
              ).length || 0;

            return (
              <ChatGroupCard
                key={group.id}
                group={group}
                orgSlug={orgSlug}
                memberCount={memberCount}
                pendingCount={pendingCount}
                isAdmin={isAdmin}
              />
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
            }
            title="No chat groups yet"
            description="Chat groups allow your organization to communicate in real-time"
            action={
              isAdmin && (
                <Link href={`/${orgSlug}/chat/new`}>
                  <Button>Create First Group</Button>
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}
