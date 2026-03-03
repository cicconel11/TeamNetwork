import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { PageHeader } from "@/components/layout/PageHeader";
import { MediaGallery } from "@/components/media/MediaGallery";
import { resolveLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";

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
  const navConfig = orgCtx.organization.nav_config as NavConfig | null;
  const pageLabel = resolveLabel("/media", navConfig);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={pageLabel}
        description="Browse and share photos and videos"
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
