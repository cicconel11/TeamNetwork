import { redirect } from "next/navigation";

interface ChatPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function ChatPage({ params }: ChatPageProps) {
  const { orgSlug } = await params;
  redirect(`/${orgSlug}/messages`);
}
