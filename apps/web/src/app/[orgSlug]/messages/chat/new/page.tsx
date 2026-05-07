import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { isOrgAdmin, getCurrentUser } from "@/lib/auth";
import { NewChatGroupForm } from "@/app/[orgSlug]/chat/new/NewChatGroupForm";

interface NewChatGroupPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function MessagesNewGroupPage({ params }: NewChatGroupPageProps) {
  const { orgSlug } = await params;
  const supabase = await createClient();

  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .limit(1);

  const org = orgs?.[0];
  if (!org || orgError) return notFound();

  const isAdmin = await isOrgAdmin(org.id);
  if (!isAdmin) redirect(`/${orgSlug}/messages`);

  const currentUser = await getCurrentUser();
  if (!currentUser) redirect(`/auth/login?redirect=/${orgSlug}/messages/chat/new`);

  return (
    <div className="p-4 lg:p-8 max-w-2xl">
      <NewChatGroupForm
        orgSlug={orgSlug}
        organizationId={org.id}
        currentUserId={currentUser.id}
      />
    </div>
  );
}
