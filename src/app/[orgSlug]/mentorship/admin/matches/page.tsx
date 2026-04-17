import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { PageHeader } from "@/components/layout";
import { getTranslations } from "next-intl/server";
import { AdminMatchQueue } from "@/components/mentorship/AdminMatchQueue";

interface AdminMatchesPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function AdminMatchesPage({ params }: AdminMatchesPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) return null;
  if (!orgCtx.isAdmin) redirect(`/${orgSlug}/mentorship`);

  const tMentorship = await getTranslations("mentorship");

  let title = "Mentor match queue";
  let description = "Review, approve, or decline mentor requests.";
  try {
    title = tMentorship("adminMatchQueueTitle");
  } catch { /* fall back */ }
  try {
    description = tMentorship("adminMatchQueueDesc");
  } catch { /* fall back */ }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title={title} description={description} />
      <AdminMatchQueue
        orgId={orgCtx.organization.id}
        orgSlug={orgSlug}
      />
    </div>
  );
}
