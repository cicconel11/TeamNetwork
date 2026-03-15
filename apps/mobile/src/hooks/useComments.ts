import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";
import type { FeedComment, PostAuthor, UseCommentsReturn } from "@/types/feed";

export function useComments(postId: string | undefined, orgId: string | null): UseCommentsReturn {
  const isMountedRef = useRef(true);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    if (!postId) {
      if (isMountedRef.current) {
        setComments([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);

      const { data, error: fetchError } = await supabase
        .from("feed_comments")
        .select("*, author:users!feed_comments_author_id_fkey(id, full_name:name, avatar_url)")
        .eq("post_id", postId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (fetchError) throw fetchError;

      const enriched: FeedComment[] = (data || []).map((c) => ({
        ...c,
        author: (Array.isArray(c.author) ? c.author[0] : c.author) as PostAuthor | null,
      }));

      if (isMountedRef.current) {
        setComments(enriched);
        setError(null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        const message = (e as Error).message || "Failed to load comments";
        setError(message);
        sentry.captureException(e as Error, { context: "useComments", postId });
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [postId]);

  const createComment = useCallback(
    async (body: string) => {
      if (!postId || !orgId) return;

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const { error: insertError } = await supabase.from("feed_comments").insert({
          post_id: postId,
          organization_id: orgId,
          author_id: user.id,
          body: body.trim(),
        });

        if (insertError) throw insertError;
        // Realtime subscription will trigger refetch
      } catch (e) {
        const message = (e as Error).message || "Failed to add comment";
        showToast(message, "error");
        sentry.captureException(e as Error, { context: "useComments.createComment", postId });
        throw e;
      }
    },
    [postId, orgId]
  );

  const deleteComment = useCallback(async (commentId: string) => {
    try {
      const { data, error: deleteError } = await supabase
        .from("feed_comments")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", commentId)
        .select("id");

      if (deleteError) throw deleteError;
      if (!data || data.length === 0) throw new Error("Comment not found or not authorized");

      if (isMountedRef.current) {
        setComments((prev) => prev.filter((c) => c.id !== commentId));
      }
      showToast("Comment deleted");
    } catch (e) {
      const message = (e as Error).message || "Failed to delete comment";
      showToast(message, "error");
      sentry.captureException(e as Error, { context: "useComments.deleteComment", commentId });
      throw e;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchComments();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchComments]);

  useEffect(() => {
    if (!postId) return;

    const channel = supabase
      .channel(`feed_comments:${postId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "feed_comments",
          filter: `post_id=eq.${postId}`,
        },
        () => {
          fetchComments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [postId, fetchComments]);

  return {
    comments,
    loading,
    error,
    refetch: fetchComments,
    createComment,
    deleteComment,
  };
}
