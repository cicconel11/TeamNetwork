import { redirect, notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/supabase/service";
import { EditParentForm } from "@/components/parents";

interface ParentRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone_number: string | null;
  photo_url: string | null;
  linkedin_url: string | null;
  student_name: string | null;
  relationship: string | null;
  notes: string | null;
  deleted_at: string | null;
}

interface EditParentPageProps {
  params: Promise<{ orgSlug: string; parentId: string }>;
}

export default async function EditParentPage({ params }: EditParentPageProps) {
  const { orgSlug, parentId } = await params;

  const orgContext = await getOrgContext(orgSlug);

  if (!orgContext.hasParentsAccess) {
    redirect(`/${orgSlug}`);
  }

  if (!orgContext.organization) {
    return notFound();
  }

  const serviceSupabase = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: parentData } = await (serviceSupabase as any)
    .from("parents")
    .select("*")
    .eq("id", parentId)
    .eq("organization_id", orgContext.organization.id)
    .is("deleted_at", null)
    .single();

  if (!parentData) {
    return notFound();
  }

  const parent = parentData as ParentRow;
  const isAdmin = orgContext.role === "admin";
  const isSelf = Boolean(orgContext.userId && parent.user_id === orgContext.userId);

  if (!isAdmin && !isSelf) {
    redirect(`/${orgSlug}/parents/${parentId}`);
  }

  return (
    <EditParentForm
      orgId={orgContext.organization.id}
      orgSlug={orgSlug}
      parentId={parentId}
      initialData={{
        first_name: parent.first_name,
        last_name: parent.last_name,
        email: parent.email,
        phone_number: parent.phone_number,
        photo_url: parent.photo_url,
        linkedin_url: parent.linkedin_url,
        student_name: parent.student_name,
        relationship: parent.relationship,
        notes: parent.notes,
      }}
    />
  );
}
