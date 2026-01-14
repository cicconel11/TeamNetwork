import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { PageHeader } from "@/components/layout/PageHeader";
import { ThreadForm } from "@/components/discussions/ThreadForm";

export default async function NewThreadPage({ params }: { params: { orgSlug: string } }) {
  const { orgSlug } = params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) {
    return notFound();
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <PageHeader title="New Thread" description="Start a new discussion" backHref={`/${orgSlug}/discussions`} />
      <ThreadForm orgId={orgCtx.organization.id} orgSlug={orgSlug} />
    </div>
  );
}
