import { redirect } from "next/navigation";

interface ChatGroupRedirectProps {
  params: Promise<{ orgSlug: string; groupId: string }>;
}

export default async function ChatGroupPage({ params }: ChatGroupRedirectProps) {
  const { orgSlug, groupId } = await params;
  redirect(`/${orgSlug}/messages/chat/${groupId}`);
}
