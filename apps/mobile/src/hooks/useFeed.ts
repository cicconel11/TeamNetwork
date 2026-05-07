import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { fetchWithAuth } from "@/lib/web-api";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";
import type { FeedPost, PostAuthor, MediaAttachment, UseFeedReturn } from "@/types/feed";

const STALE_TIME_MS = 30_000;
const PAGE_SIZE = 20;

export function useFeed(orgId: string | null): UseFeedReturn {
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const generationRef = useRef(0);
  const postsRef = useRef<FeedPost[]>([]);
  const pendingPostsRef = useRef<FeedPost[]>([]);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [pendingPosts, setPendingPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);

  // Reset state when orgId changes
  useEffect(() => {
    lastFetchTimeRef.current = 0;
    setOffset(0);
    setHasMore(false);
    setTotalCount(null);
    setPendingPosts([]);
    generationRef.current += 1;
  }, [orgId, userId]);

  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  useEffect(() => {
    pendingPostsRef.current = pendingPosts;
  }, [pendingPosts]);

  const fetchPosts = useCallback(
    async (fetchOffset: number = 0, append: boolean = false) => {
      if (!orgId || !userId) {
        if (isMountedRef.current) {
          setPosts([]);
          setError(null);
          setLoading(false);
          setHasMore(false);
          setTotalCount(null);
        }
        return;
      }

      const currentGeneration = generationRef.current;

      try {
        if (append) {
          setLoadingMore(true);
        } else {
          setLoading(true);
        }

        // Fetch posts with author join
        const {
          data: postsData,
          error: postsError,
          count,
        } = await supabase
          .from("feed_posts")
          .select("*, author:users!feed_posts_author_id_fkey(id, full_name:name, avatar_url)", {
            count: "exact",
          })
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .range(fetchOffset, fetchOffset + PAGE_SIZE - 1);

        if (postsError) throw postsError;
        if (currentGeneration !== generationRef.current) return;

        const rawPosts = postsData || [];
        const postIds = rawPosts.map((p) => p.id);

        // Fetch likes and media in parallel
        const [likesResult, mediaResult] = await Promise.all([
          postIds.length > 0
            ? supabase
                .from("feed_likes")
                .select("post_id")
                .eq("user_id", userId)
                .in("post_id", postIds)
            : Promise.resolve({ data: null }),
          postIds.length > 0
            ? supabase
                .from("media_uploads")
                .select("id, storage_path, mime_type, file_name, entity_id")
                .eq("entity_type", "feed_post")
                .eq("status", "ready")
                .in("entity_id", postIds)
                .is("deleted_at", null)
            : Promise.resolve({ data: null }),
        ]);

        const likedPostIds: Set<string> = new Set(
          (likesResult.data ?? []).map((l: { post_id: string }) => l.post_id)
        );

        const mediaByPostId: Map<string, MediaAttachment[]> = new Map();
        for (const m of mediaResult.data ?? []) {
          const entityId = (m as { entity_id: string | null }).entity_id;
          if (!entityId) continue;
          const existing = mediaByPostId.get(entityId) || [];
          existing.push({
            id: (m as { id: string }).id,
            storage_path: (m as { storage_path: string }).storage_path,
            mime_type: (m as { mime_type: string | null }).mime_type ?? "",
            file_name: (m as { file_name: string | null }).file_name ?? "",
          });
          mediaByPostId.set(entityId, existing);
        }

        if (currentGeneration !== generationRef.current) return;

        // Combine into FeedPost[]
        const enrichedPosts: FeedPost[] = rawPosts.map((post) => ({
          ...post,
          author: (Array.isArray(post.author) ? post.author[0] : post.author) as PostAuthor | null,
          liked_by_user: likedPostIds.has(post.id),
          media: mediaByPostId.get(post.id) || [],
        }));

        if (isMountedRef.current) {
          if (append) {
            setPosts((prev) => [...prev, ...enrichedPosts]);
          } else {
            setPosts(enrichedPosts);
            setPendingPosts([]);
          }

          setError(null);
          lastFetchTimeRef.current = Date.now();

          if (count !== null) {
            setTotalCount(count);
            setHasMore(fetchOffset + rawPosts.length < count);
          } else {
            setHasMore(rawPosts.length === PAGE_SIZE);
          }

          setOffset(fetchOffset + rawPosts.length);
        }
      } catch (e) {
        if (isMountedRef.current) {
          const message = (e as Error).message || "An error occurred";
          setError(message);
          showToast(message, "error");
          sentry.captureException(e as Error, {
            context: "useFeed",
            orgId,
          });
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [orgId, userId]
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading) return;
    await fetchPosts(offset, true);
  }, [hasMore, loadingMore, loading, offset, fetchPosts]);

  const refetch = useCallback(async () => {
    generationRef.current += 1;
    setOffset(0);
    await fetchPosts(0, false);
  }, [fetchPosts]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      generationRef.current += 1;
      setOffset(0);
      fetchPosts(0, false);
    }
  }, [fetchPosts]);

  const acceptPendingPosts = useCallback(() => {
    setPosts((prev) => [...pendingPosts, ...prev]);
    setPendingPosts([]);
  }, [pendingPosts]);

  // Toggle like with optimistic update
  const toggleLike = useCallback(
    async (postId: string) => {
      if (!userId || !orgId) return;

      // Find current state
      const currentPost =
        posts.find((p) => p.id === postId) || pendingPosts.find((p) => p.id === postId);
      if (!currentPost) return;

      const wasLiked = currentPost.liked_by_user;

      // Optimistic update
      const updateLikeState = (postsList: FeedPost[]) =>
        postsList.map((p) =>
          p.id === postId
            ? {
                ...p,
                liked_by_user: !wasLiked,
                like_count: wasLiked ? Math.max(0, p.like_count - 1) : p.like_count + 1,
              }
            : p
        );

      setPosts(updateLikeState);
      setPendingPosts(updateLikeState);

      try {
        if (wasLiked) {
          const { error: unlikeError } = await supabase
            .from("feed_likes")
            .delete()
            .eq("post_id", postId)
            .eq("user_id", userId);
          if (unlikeError) throw unlikeError;
        } else {
          const { error: likeError } = await supabase.from("feed_likes").insert({
            post_id: postId,
            user_id: userId,
            organization_id: orgId,
          });
          if (likeError) throw likeError;
        }
      } catch (e) {
        // Revert optimistic update
        const revertLikeState = (postsList: FeedPost[]) =>
          postsList.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  liked_by_user: wasLiked,
                  like_count: wasLiked
                    ? p.like_count + 1
                    : Math.max(0, p.like_count - 1),
                }
              : p
          );
        setPosts(revertLikeState);
        setPendingPosts(revertLikeState);
        showToast("Failed to update like", "error");
        sentry.captureException(e as Error, { context: "useFeed.toggleLike", postId });
      }
    },
    [userId, orgId, posts, pendingPosts]
  );

  // Create post
  const createPost = useCallback(
    async (body: string, mediaIds: string[] = []) => {
      if (!userId || !orgId) return;

      try {
        const response = await fetchWithAuth("/api/feed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            body: body.trim(),
            mediaIds,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to create post");
        }

        await refetch();
        showToast("Post created");
      } catch (e) {
        const message = (e as Error).message || "Failed to create post";
        showToast(message, "error");
        sentry.captureException(e as Error, { context: "useFeed.createPost", orgId });
        throw e;
      }
    },
    [userId, orgId, refetch]
  );

  // Update post
  const updatePost = useCallback(async (postId: string, body: string) => {
    try {
      const { data, error: updateError } = await supabase
        .from("feed_posts")
        .update({ body: body.trim(), updated_at: new Date().toISOString() })
        .eq("id", postId)
        .select("id");
      if (updateError) throw updateError;
      if (!data || data.length === 0) throw new Error("Post not found or not authorized");
      showToast("Post updated");
    } catch (e) {
      const message = (e as Error).message || "Failed to update post";
      showToast(message, "error");
      sentry.captureException(e as Error, { context: "useFeed.updatePost", postId });
      throw e;
    }
  }, []);

  // Delete post (soft delete)
  const deletePost = useCallback(async (postId: string) => {
    try {
      const { error: deleteError } = await supabase
        .from("feed_posts")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", postId);
      if (deleteError) throw deleteError;

      // Remove from local state immediately
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      showToast("Post deleted");
    } catch (e) {
      const message = (e as Error).message || "Failed to delete post";
      showToast(message, "error");
      sentry.captureException(e as Error, { context: "useFeed.deletePost", postId });
      throw e;
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchPosts(0, false);

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchPosts]);

  // Realtime subscription
  useEffect(() => {
    if (!orgId || !userId) return;

    const channel = createPostgresChangesChannel(`feed_posts:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "feed_posts",
          filter: `organization_id=eq.${orgId}`,
        },
        async (payload) => {
          const newPost = payload.new as FeedPost;
          if (newPost.author_id === userId) {
            void refetch();
            return;
          }

          if (!isMountedRef.current) return;

          // Fetch author info for the new post
          // users table has "name" column; map to PostAuthor's full_name field
          const { data: authorData } = await supabase
            .from("users")
            .select("id, name, avatar_url")
            .eq("id", newPost.author_id)
            .single();

          if (!isMountedRef.current) return;

          const author: PostAuthor | null = authorData
            ? { id: authorData.id, full_name: authorData.name, avatar_url: authorData.avatar_url }
            : null;

          const enrichedPost: FeedPost = {
            ...newPost,
            author,
            liked_by_user: false,
            media: [],
          };

          setPendingPosts((prev) => {
            if (
              prev.some((post) => post.id === enrichedPost.id) ||
              postsRef.current.some((post) => post.id === enrichedPost.id) ||
              pendingPostsRef.current.some((post) => post.id === enrichedPost.id)
            ) {
              return prev;
            }
            return [enrichedPost, ...prev];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "feed_posts",
          filter: `organization_id=eq.${orgId}`,
        },
        (payload) => {
          const updated = payload.new as FeedPost;
          if (isMountedRef.current) {
            // If soft-deleted, remove from local state
            if (updated.deleted_at) {
              setPosts((prev) => prev.filter((p) => p.id !== updated.id));
              setPendingPosts((prev) => prev.filter((p) => p.id !== updated.id));
            } else {
              // Update in place (e.g., body edit, like_count change from trigger)
              const updateInPlace = (postsList: FeedPost[]) =>
                postsList.map((p) =>
                  p.id === updated.id
                    ? {
                        ...p,
                        body: updated.body,
                        like_count: updated.like_count,
                        comment_count: updated.comment_count,
                        updated_at: updated.updated_at,
                      }
                    : p
                );
              setPosts(updateInPlace);
              setPendingPosts(updateInPlace);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, userId, refetch]);

  return {
    posts,
    loading,
    loadingMore,
    error,
    hasMore,
    totalCount,
    pendingPosts,
    loadMore,
    refetch,
    refetchIfStale,
    acceptPendingPosts,
    createPost,
    updatePost,
    deletePost,
    toggleLike,
  };
}
