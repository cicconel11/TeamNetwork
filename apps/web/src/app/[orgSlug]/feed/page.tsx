import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { FeedComposer } from "@/components/feed/FeedComposer";
import { FeedList } from "@/components/feed/FeedList";

export default async function FeedPage({
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

  // Parse pagination params
  const page = parseInt(searchParams.page || "1", 10);
  const limit = 25;
  const offset = (page - 1) * limit;

  // Fetch posts with author info
  const { data: posts, error, count } = await supabase
    .from("feed_posts")
    .select(
      `
      *,
      author:users!feed_posts_author_id_fkey(name)
    `,
      { count: "exact", head: false },
    )
    .eq("organization_id", orgCtx.organization.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[FEED DEBUG] feed_posts query error:", JSON.stringify(error));
    throw new Error("Failed to load feed");
  }

  // Fetch user's likes for these posts
  const postIds = (posts || []).map((p) => p.id);
  let userLikedPostIds: Set<string> = new Set();

  if (postIds.length > 0 && orgCtx.userId) {
    const { data: likes } = await supabase
      .from("feed_likes")
      .select("post_id")
      .eq("user_id", orgCtx.userId)
      .in("post_id", postIds);

    userLikedPostIds = new Set((likes || []).map((l) => l.post_id));
  }

  // Augment posts with liked_by_user
  const augmentedPosts = (posts || []).map((post) => ({
    ...post,
    liked_by_user: userLikedPostIds.has(post.id),
  }));

  const total = count || 0;
  const totalPages = Math.ceil(total / limit);

  // Determine if user can create posts based on feed_post_roles
  const feedPostRoles: string[] =
    (orgCtx.organization as Record<string, unknown>).feed_post_roles as string[] ||
    ["admin", "active_member", "alumni"];
  const canPost = orgCtx.role ? feedPostRoles.includes(orgCtx.role) : false;

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <PageHeader
        title="Feed"
        description="Stay up to date with your team"
      />
      {canPost && (
        <div className="mb-6">
          <FeedComposer orgId={orgCtx.organization.id} />
        </div>
      )}
      <FeedList
        posts={augmentedPosts}
        orgSlug={orgSlug}
        currentUserId={orgCtx.userId || ""}
        isAdmin={orgCtx.isAdmin}
        pagination={{ page, limit, total, totalPages }}
      />
    </div>
  );
}
