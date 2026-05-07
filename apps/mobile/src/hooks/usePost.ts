import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import * as sentry from "@/lib/analytics/sentry";
import type { FeedPost, PostAuthor, MediaAttachment, UsePostReturn } from "@/types/feed";

export function usePost(postId: string | undefined): UsePostReturn {
  const isMountedRef = useRef(true);
  const [post, setPost] = useState<FeedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPost = useCallback(async () => {
    if (!postId) {
      if (isMountedRef.current) {
        setPost(null);
        setError(null);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);

      // Get current user for like status
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Fetch post with author
      const { data: postData, error: postError } = await supabase
        .from("feed_posts")
        .select("*, author:users!feed_posts_author_id_fkey(id, full_name:name, avatar_url)")
        .eq("id", postId)
        .is("deleted_at", null)
        .single();

      if (postError) throw postError;
      if (!postData) {
        if (isMountedRef.current) {
          setPost(null);
          setLoading(false);
        }
        return;
      }

      // Check if user liked this post
      const { data: likeData } = await supabase
        .from("feed_likes")
        .select("id")
        .eq("post_id", postId)
        .eq("user_id", user.id)
        .maybeSingle();

      // Fetch media
      const { data: mediaData } = await supabase
        .from("media_uploads")
        .select("id, storage_path, mime_type, file_name")
        .eq("entity_type", "feed_post")
        .eq("entity_id", postId)
        .eq("status", "ready")
        .is("deleted_at", null);

      const media: MediaAttachment[] = (mediaData || []).map((m) => ({
        id: m.id,
        storage_path: m.storage_path,
        mime_type: m.mime_type,
        file_name: m.file_name,
      }));

      const enrichedPost: FeedPost = {
        ...postData,
        author: (Array.isArray(postData.author)
          ? postData.author[0]
          : postData.author) as PostAuthor | null,
        liked_by_user: !!likeData,
        media,
      };

      if (isMountedRef.current) {
        setPost(enrichedPost);
        setError(null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        const message = (e as Error).message || "Failed to load post";
        setError(message);
        sentry.captureException(e as Error, { context: "usePost", postId });
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [postId]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchPost();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchPost]);

  // Realtime subscription for post updates
  useEffect(() => {
    if (!postId) return;

    const channel = createPostgresChangesChannel(`post_detail:${postId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "feed_posts",
          filter: `id=eq.${postId}`,
        },
        (payload) => {
          const updated = payload.new as { deleted_at: string | null };
          if (updated.deleted_at) {
            // Post was soft-deleted
            if (isMountedRef.current) {
              setPost(null);
            }
          } else {
            // Refetch to get full enriched data
            fetchPost();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [postId, fetchPost]);

  return {
    post,
    loading,
    error,
    refetch: fetchPost,
  };
}
