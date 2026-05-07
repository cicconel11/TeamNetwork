import { z } from "zod";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { RecordForm } from "@/components/records/RecordForm";
import { getOrgContext } from "@/lib/auth/roles";

const uuidSchema = z.string().uuid();

interface EditRecordPageProps {
  params: Promise<{ orgSlug: string; id: string }>;
}

export default async function EditRecordPage({ params }: EditRecordPageProps) {
  const { orgSlug, id } = await params;

  if (!uuidSchema.safeParse(id).success) return notFound();

  const { organization: org, isAdmin } = await getOrgContext(orgSlug);

  if (!org || !isAdmin) return notFound();

  const supabase = await createClient();

  const { data: record } = await supabase
    .from("records")
    .select("*")
    .eq("id", id)
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .single();

  if (!record) return notFound();

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Edit Record"
        description="Update record details"
        backHref={`/${orgSlug}/records`}
      />

      <RecordForm
        orgSlug={orgSlug}
        recordId={record.id}
        defaultValues={{
          title: record.title || "",
          category: record.category || "",
          value: record.value || "",
          holder_name: record.holder_name || "",
          year: record.year ? String(record.year) : "",
          notes: record.notes || "",
        }}
      />
    </div>
  );
}
