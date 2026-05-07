import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/roles";
import { notFound } from "next/navigation";
import { ChannelSidebar } from "@/components/messages/ChannelSidebar";
import { MessagesEmptyState } from "@/components/messages/EmptyState";

interface MessagesPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function MessagesPage({ params }: MessagesPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) return notFound();

  const supabase = await createClient();
  const orgId = orgCtx.organization.id;

  // On mobile, show a channel list instead of the empty state
  // Fetch data for mobile sidebar view
  const { data: chatGroups } = await supabase
    .from("chat_groups")
    .select("id, name, description, is_default, last_activity_at")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  const { data: threads } = await supabase
    .from("discussion_threads")
    .select("id, title, is_pinned, is_locked, reply_count, last_activity_at")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("is_pinned", { ascending: false })
    .order("last_activity_at", { ascending: false })
    .limit(50);

  return (
    <>
      {/* Mobile: show channel list */}
      <div className="lg:hidden h-full">
        <ChannelSidebar
          chatGroups={chatGroups || []}
          discussionThreads={threads || []}
          orgSlug={orgSlug}
          isAdmin={orgCtx.isAdmin}
        />
      </div>

      {/* Desktop: show empty state */}
      <div className="hidden lg:flex flex-1 h-full">
        <MessagesEmptyState />
      </div>
    </>
  );
}
