import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { ThreadForm } from "@/components/discussions/ThreadForm";

interface NewThreadPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function MessagesNewThreadPage({ params }: NewThreadPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) return notFound();

  return (
    <div className="p-4 lg:p-8 max-w-2xl">
      <h1 className="text-xl font-bold text-foreground mb-2">New Thread</h1>
      <p className="text-sm text-muted-foreground mb-6">Start a new discussion</p>
      <ThreadForm orgId={orgCtx.organization.id} orgSlug={orgSlug} />
    </div>
  );
}
