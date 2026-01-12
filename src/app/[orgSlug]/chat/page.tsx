import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Button, EmptyState, Badge } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { isOrgAdmin } from "@/lib/auth";
import type { ChatGroup, ChatGroupMember } from "@/types/database";

interface ChatPageProps {
  params: Promise<{ orgSlug: string }>;
}

type ChatGroupWithMembers = ChatGroup & {
  chat_group_members: Pick<ChatGroupMember, "id" | "user_id" | "role">[];
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
      chat_group_members (id, user_id, role)
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
            const memberCount = group.chat_group_members?.length || 0;

            return (
              <Link key={group.id} href={`/${orgSlug}/chat/${group.id}`}>
                <Card className="p-4 hover:border-[var(--color-org-secondary)] transition-colors cursor-pointer h-full">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground truncate">{group.name}</h3>
                        {group.is_default && (
                          <Badge variant="primary">Default</Badge>
                        )}
                      </div>
                      {group.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {group.description}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        {memberCount} member{memberCount !== 1 ? "s" : ""}
                        {group.require_approval && " | Approval required"}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {pendingCount > 0 && (
                        <Badge variant="warning">{pendingCount} pending</Badge>
                      )}
                      <div className="h-8 w-8 rounded-lg bg-[var(--color-org-secondary)]/20 flex items-center justify-center">
                        <svg className="h-4 w-4 text-[var(--color-org-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
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
