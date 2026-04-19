import { redirect } from "next/navigation";

export default async function NewThreadPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  redirect(`/${orgSlug}/messages/threads/new`);
}
