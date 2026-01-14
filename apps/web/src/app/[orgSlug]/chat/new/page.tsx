import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { isOrgAdmin, getCurrentUser } from "@/lib/auth";
import { NewChatGroupForm } from "./NewChatGroupForm";

interface NewChatGroupPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function NewChatGroupPage({ params }: NewChatGroupPageProps) {
  const { orgSlug } = await params;
  const supabase = await createClient();

  // Fetch organization
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .limit(1);

  const org = orgs?.[0];
  if (!org || orgError) return notFound();

  // Only admins can create groups
  const isAdmin = await isOrgAdmin(org.id);
  if (!isAdmin) {
    redirect(`/${orgSlug}/chat`);
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect(`/auth/login?redirect=/${orgSlug}/chat/new`);
  }

  return (
    <NewChatGroupForm
      orgSlug={orgSlug}
      organizationId={org.id}
      currentUserId={currentUser.id}
    />
  );
}
