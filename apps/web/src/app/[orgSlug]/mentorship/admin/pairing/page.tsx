import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { PageHeader } from "@/components/layout";
import { createClient } from "@/lib/supabase/server";
import { getPairableOrgMembers } from "@/lib/mentorship/queries";
import { AdminPairingBoard } from "@/components/mentorship/AdminPairingBoard";

interface AdminPairingPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function AdminPairingPage({ params }: AdminPairingPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) return null;
  if (!orgCtx.isAdmin) redirect(`/${orgSlug}/mentorship`);

  const supabase = await createClient();
  const { mentees } = await getPairableOrgMembers(supabase, orgCtx.organization.id);

  const menteeOptions = mentees
    .map((m) => ({
      user_id: m.user_id,
      name: m.name ?? m.email ?? "Member",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Assign a mentor"
        description="Pick a student to see the best available alumni mentors, why they fit, and confirm a pairing."
      />
      <AdminPairingBoard
        orgId={orgCtx.organization.id}
        mentees={menteeOptions}
      />
    </div>
  );
}
