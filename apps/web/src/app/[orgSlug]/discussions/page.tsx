import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { ThreadList } from "@/components/discussions/ThreadList";

export default async function DiscussionsPage({
  params,
  searchParams,
}: {
  params: { orgSlug: string };
  searchParams: { page?: string };
}) {
  const { orgSlug } = params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) {
    return notFound();
  }

  const supabase = await createClient();
  const discussionPostRoles = (orgCtx.organization as Record<string, unknown>).discussion_post_roles as string[] || ["admin", "active_member", "alumni"];
  const canPost = orgCtx.role ? discussionPostRoles.includes(orgCtx.role) : false;

  // Parse pagination params
  const page = parseInt(searchParams.page || "1", 10);
  const limit = 25;
  const offset = (page - 1) * limit;

  const { data: threads, error, count } = await supabase
    .from("discussion_threads")
    .select(
      `
      *,
      author:users!discussion_threads_author_id_fkey(name)
    `,
      { count: "exact", head: false },
    )
    .eq("organization_id", orgCtx.organization.id)
    .is("deleted_at", null)
    .order("is_pinned", { ascending: false })
    .order("last_activity_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error("Failed to load discussions");
  }

  const total = count || 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <PageHeader
        title="Discussions"
        description="Join the conversation with your team"
        actions={canPost && <ButtonLink href={`/${orgSlug}/discussions/new`}>New Thread</ButtonLink>}
      />
      <ThreadList
        threads={threads || []}
        orgSlug={orgSlug}
        pagination={{ page, limit, total, totalPages }}
      />
    </div>
  );
}
