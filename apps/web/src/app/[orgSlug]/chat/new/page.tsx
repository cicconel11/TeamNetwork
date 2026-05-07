import { redirect } from "next/navigation";

interface NewChatRedirectProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function NewChatGroupPage({ params }: NewChatRedirectProps) {
  const { orgSlug } = await params;
  redirect(`/${orgSlug}/messages/chat/new`);
}
