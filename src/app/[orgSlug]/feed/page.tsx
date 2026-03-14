import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchMediaForEntities } from "@/lib/media/fetch";

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

  // Fetch media attachments for all posts
  const mediaMap = postIds.length > 0
    ? await fetchMediaForEntities(createServiceClient(), "feed_post", postIds, orgCtx.organization.id)
    : new Map();

  // Augment posts with liked_by_user and media
  const augmentedPosts = (posts || []).map((post) => ({
    ...post,
    liked_by_user: userLikedPostIds.has(post.id),
    media: mediaMap.get(post.id) ?? [],
  }));

  const total = count || 0;
  const totalPages = Math.ceil(total / limit);

  // Determine if user can create posts based on feed_post_roles
  const feedPostRoles: string[] =
    (orgCtx.organization as Record<string, unknown>).feed_post_roles as string[] ||
    ["admin", "active_member", "alumni"];
  const canPost = orgCtx.role ? feedPostRoles.includes(orgCtx.role) : false;

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground font-mono">
          Team Feed
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
      {canPost && (
        <div className="mb-5">
          <FeedComposer orgId={orgCtx.organization.id} />
        </div>
      )}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-px flex-1 bg-border/50" />
        <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-muted-foreground/50">
          Recent
        </span>
        <div className="h-px flex-1 bg-border/50" />
      </div>
      <FeedList
        posts={augmentedPosts}
        orgSlug={orgSlug}
        currentUserId={orgCtx.userId || ""}
        isAdmin={orgCtx.isAdmin}
        pagination={{ page, total, totalPages }}
      />
    </>
  );
}
