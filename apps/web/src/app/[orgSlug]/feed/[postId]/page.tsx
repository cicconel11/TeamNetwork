import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { PostDetail } from "@/components/feed/PostDetail";
import { CommentSection } from "@/components/feed/CommentSection";

export default async function FeedPostDetailPage({
  params,
}: {
  params: { orgSlug: string; postId: string };
}) {
  const { orgSlug, postId } = params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) {
    return notFound();
  }

  const supabase = await createClient();

  // Fetch post
  const { data: post, error: postError } = await supabase
    .from("feed_posts")
    .select(
      `
      *,
      author:users!feed_posts_author_id_fkey(name)
    `,
    )
    .eq("id", postId)
    .eq("organization_id", orgCtx.organization.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (postError) {
    throw new Error("Failed to load post");
  }

  if (!post) {
    return notFound();
  }

  // Fetch comments
  const { data: comments, error: commentsError } = await supabase
    .from("feed_comments")
    .select(
      `
      *,
      author:users!feed_comments_author_id_fkey(name)
    `,
    )
    .eq("post_id", postId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (commentsError) {
    throw new Error("Failed to load comments");
  }

  // Check if user has liked this post
  let likedByUser = false;
  if (orgCtx.userId) {
    const { data: like } = await supabase
      .from("feed_likes")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", orgCtx.userId)
      .maybeSingle();
    likedByUser = !!like;
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <PageHeader title="Post" backHref={`/${orgSlug}/feed`} />
      <PostDetail
        post={{ ...post, liked_by_user: likedByUser }}
        orgSlug={orgSlug}
        currentUserId={orgCtx.userId || ""}
        isAdmin={orgCtx.isAdmin}
      />
      <div className="mt-8">
        <CommentSection postId={postId} comments={comments || []} />
      </div>
    </div>
  );
}
