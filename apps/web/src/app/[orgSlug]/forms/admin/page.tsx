import { redirect } from "next/navigation";

interface AdminFormsPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function AdminFormsPage({ params }: AdminFormsPageProps) {
  const { orgSlug } = await params;
  redirect(`/${orgSlug}/forms`);
}
