import { redirect } from "next/navigation";

export default async function NewThreadPage({ params }: { params: { orgSlug: string } }) {
  const { orgSlug } = params;
  redirect(`/${orgSlug}/messages/threads/new`);
}
