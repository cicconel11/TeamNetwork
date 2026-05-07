import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { ThreadMessagePane } from "@/components/messages/ThreadMessagePane";

interface ThreadPageProps {
  params: Promise<{ orgSlug: string; threadId: string }>;
}

export default async function MessagesThreadPage({ params }: ThreadPageProps) {
  const { orgSlug, threadId } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) return notFound();

  const supabase = await createClient();

  const { data: thread, error: threadError } = await supabase
    .from("discussion_threads")
    .select(`*, author:users!discussion_threads_author_id_fkey(name)`)
    .eq("id", threadId)
    .eq("organization_id", orgCtx.organization.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (threadError) throw new Error("Failed to load thread");
  if (!thread) return notFound();

  const { data: replies, error: repliesError } = await supabase
    .from("discussion_replies")
    .select(`*, author:users!discussion_replies_author_id_fkey(name)`)
    .eq("thread_id", threadId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (repliesError) throw new Error("Failed to load replies");

  return (
    <ThreadMessagePane
      thread={thread}
      replies={replies || []}
      isAdmin={orgCtx.isAdmin}
      orgSlug={orgSlug}
    />
  );
}
