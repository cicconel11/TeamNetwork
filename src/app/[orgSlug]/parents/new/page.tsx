import { redirect, notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { NewParentForm } from "@/components/parents";

interface NewParentPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function NewParentPage({ params }: NewParentPageProps) {
  const { orgSlug } = await params;

  const orgContext = await getOrgContext(orgSlug);

  if (!orgContext.hasParentsAccess) {
    redirect(`/${orgSlug}`);
  }

  if (!orgContext.organization) {
    return notFound();
  }

  // Admin only — members cannot create parent records
  if (orgContext.role !== "admin") {
    redirect(`/${orgSlug}/parents`);
  }

  return (
    <NewParentForm
      orgId={orgContext.organization.id}
      orgSlug={orgSlug}
    />
  );
}
