import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout";
import { RecordForm } from "@/components/records/RecordForm";
import { getOrgContext } from "@/lib/auth/roles";

interface NewRecordPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function NewRecordPage({ params }: NewRecordPageProps) {
  const { orgSlug } = await params;
  const { organization: org, isAdmin } = await getOrgContext(orgSlug);

  if (!org || !isAdmin) return notFound();

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Add New Record"
        description="Add a record to your organization's record book"
        backHref={`/${orgSlug}/records`}
      />

      <RecordForm orgSlug={orgSlug} />
    </div>
  );
}
