import { notFound } from "next/navigation";
import dynamic from "next/dynamic";
import { getOrgContext } from "@/lib/auth/roles";
import { PageHeader } from "@/components/layout/PageHeader";

const MediaGallery = dynamic(
  () => import("@/components/media/MediaGallery").then((mod) => mod.MediaGallery),
  { loading: () => <div className="animate-pulse bg-[var(--muted)] rounded-2xl h-96" /> }
);

export default async function MediaArchivePage({
  params,
}: {
  params: { orgSlug: string };
}) {
  const { orgSlug } = params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) {
    return notFound();
  }

  const mediaUploadRoles = (orgCtx.organization as Record<string, unknown>).media_upload_roles as string[] || ["admin"];
  const canUpload = orgCtx.role ? mediaUploadRoles.includes(orgCtx.role) : false;
  const isAdmin = orgCtx.role === "admin";

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <PageHeader
        title="Media Archive"
        description="Browse and share photos and videos with your organization"
      />
      <MediaGallery
        orgId={orgCtx.organization.id}
        canUpload={canUpload}
        isAdmin={isAdmin}
        currentUserId={orgCtx.userId || undefined}
      />
    </div>
  );
}
