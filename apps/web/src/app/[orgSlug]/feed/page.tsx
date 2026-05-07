import { redirect } from "next/navigation";

export default async function FeedPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  redirect(`/${orgSlug}`);
}
