import { redirect } from "next/navigation";

export default async function DiscussionsPage({ params }: { params: { orgSlug: string } }) {
  const { orgSlug } = params;
  redirect(`/${orgSlug}/messages`);
}
