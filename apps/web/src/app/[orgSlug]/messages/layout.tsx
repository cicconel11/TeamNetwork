import { createClient } from "@/lib/supabase/server";
import { getOrgContext, getCurrentUser } from "@/lib/auth/roles";
import { notFound, redirect } from "next/navigation";
import { ChannelSidebar } from "@/components/messages/ChannelSidebar";

interface MessagesLayoutProps {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}

export default async function MessagesLayout({ children, params }: MessagesLayoutProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) return notFound();

  const currentUser = await getCurrentUser();
  if (!currentUser) redirect(`/auth/login?redirect=/${orgSlug}/messages`);

  const supabase = await createClient();
  const orgId = orgCtx.organization.id;

  // Fetch chat groups user is a member of (or all if admin)
  const { data: chatGroups, error: chatGroupsError } = await supabase
    .from("chat_groups")
    .select("id, name, description, is_default, updated_at")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  if (chatGroupsError) {
    console.error("[messages-layout] chat_groups query failed:", chatGroupsError.message, chatGroupsError);
  }

  // Fetch discussion threads
  const { data: threads, error: threadsError } = await supabase
    .from("discussion_threads")
    .select("id, title, is_pinned, is_locked, reply_count, last_activity_at")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("is_pinned", { ascending: false })
    .order("last_activity_at", { ascending: false })
    .limit(50);

  if (threadsError) {
    console.error("[messages-layout] discussion_threads query failed:", threadsError.message, threadsError);
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar - hidden on mobile, shown on lg+ */}
      <div className="hidden lg:block w-[280px] flex-shrink-0 border-r border-border h-full">
        <ChannelSidebar
          chatGroups={chatGroups || []}
          discussionThreads={threads || []}
          orgSlug={orgSlug}
          isAdmin={orgCtx.isAdmin}
        />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
