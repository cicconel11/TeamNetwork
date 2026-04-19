import { redirect } from "next/navigation";

export default async function ThreadDetailPage({ params }: { params: Promise<{ orgSlug: string; threadId: string }> }) {
  const { orgSlug, threadId } = await params;
  redirect(`/${orgSlug}/messages/threads/${threadId}`);
}
