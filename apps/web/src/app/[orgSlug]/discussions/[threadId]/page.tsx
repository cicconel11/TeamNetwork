import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { ThreadDetail } from "@/components/discussions/ThreadDetail";
import { ReplyForm } from "@/components/discussions/ReplyForm";

export default async function ThreadDetailPage({ params }: { params: { orgSlug: string; threadId: string } }) {
  const { orgSlug, threadId } = params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) {
    return notFound();
  }

  const supabase = await createClient();

  // Fetch thread
  const { data: thread, error: threadError } = await supabase
    .from("discussion_threads")
    .select(
      `
      *,
      author:users!discussion_threads_author_id_fkey(name)
    `,
    )
    .eq("id", threadId)
    .eq("organization_id", orgCtx.organization.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (threadError) {
    throw new Error("Failed to load thread");
  }

  if (!thread) {
    return notFound();
  }

  // Fetch replies
  const { data: replies, error: repliesError } = await supabase
    .from("discussion_replies")
    .select(
      `
      *,
      author:users!discussion_replies_author_id_fkey(name)
    `,
    )
    .eq("thread_id", threadId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (repliesError) {
    throw new Error("Failed to load replies");
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <PageHeader title="Discussion" backHref={`/${orgSlug}/discussions`} />
      <ThreadDetail thread={thread} replies={replies || []} isAdmin={orgCtx.isAdmin} orgSlug={orgSlug} />
      <div className="mt-8">
        <ReplyForm threadId={threadId} isLocked={thread.is_locked} />
      </div>
    </div>
  );
}
