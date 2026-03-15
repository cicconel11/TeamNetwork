import { redirect } from "next/navigation";

export default async function ThreadDetailPage({ params }: { params: { orgSlug: string; threadId: string } }) {
  const { orgSlug, threadId } = params;
  redirect(`/${orgSlug}/messages/threads/${threadId}`);
}
