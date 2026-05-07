import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveDataClient } from "@/lib/auth/dev-admin";
import { getOrgRole } from "@/lib/auth/roles";
import { canEditNavItem } from "@/lib/navigation/permissions";
import { checkOrgReadOnly } from "@/lib/subscription/read-only-guard";
import { EditAlumniForm } from "@/components/alumni/EditAlumniForm";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { Organization, Alumni } from "@/types/database";

interface EditAlumniPageProps {
  params: Promise<{ orgSlug: string; alumniId: string }>;
}

export default async function EditAlumniPage({ params }: EditAlumniPageProps) {
  const { orgSlug, alumniId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const dataClient = resolveDataClient(user, supabase, "view_members");

  // Fetch organization
  const { data: orgData, error: orgError } = await dataClient
    .from("organizations")
    .select("id, nav_config")
    .eq("slug", orgSlug)
    .limit(1);

  if (!orgData?.[0] || orgError) {
    return notFound();
  }

  const org = orgData[0] as Organization;
  const orgId = org.id;

  // Fetch alumni + auth check in parallel (both only need orgId)
  const [{ data: alumData }, { role, userId: currentUserId }, { isReadOnly }] = await Promise.all([
    dataClient
      .from("alumni")
      .select("*")
      .eq("id", alumniId)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .single(),
    getOrgRole({ orgId, userId: user?.id }),
    checkOrgReadOnly(orgId),
  ]);

  if (!alumData) {
    return notFound();
  }

  const alum = alumData as Alumni;
  const navConfig = org.nav_config as NavConfig | null;
  const canEditPage = canEditNavItem(navConfig, "/alumni", role, ["admin"]);
  const alumUserId = alum.user_id || null;
  const isSelf = Boolean(currentUserId && alumUserId === currentUserId);
  const canEdit = canEditPage || isSelf;

  if (!canEdit) {
    return notFound();
  }

  return (
    <EditAlumniForm
      alumni={alum}
      orgSlug={orgSlug}
      isReadOnly={isReadOnly}
    />
  );
}
