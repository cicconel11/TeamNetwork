import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import * as sentry from "@/lib/analytics/sentry";
import { showToast } from "@/components/ui/Toast";
import type {
  FeedPost,
  PostAuthor,
  MediaAttachment,
  PollMetadata,
  UsePostReturn,
} from "@/types/feed";

export function usePost(postId: string | undefined): UsePostReturn {
  const isMountedRef = useRef(true);
  const [post, setPost] = useState<FeedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const postRef = useRef<FeedPost | null>(null);

  useEffect(() => {
    postRef.current = post;
  }, [post]);

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

      const isPoll = (postData as { post_type?: string | null }).post_type === "poll";

      // Fetch like, media, and (if poll) votes in parallel.
      const [likeResult, mediaResult, userVoteResult, allVotesResult] = await Promise.all([
        supabase
          .from("feed_likes")
          .select("id")
          .eq("post_id", postId)
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("media_uploads")
          .select("id, storage_path, mime_type, file_name")
          .eq("entity_type", "feed_post")
          .eq("entity_id", postId)
          .eq("status", "ready")
          .is("deleted_at", null),
        isPoll
          ? supabase
              .from("feed_poll_votes")
              .select("option_index")
              .eq("post_id", postId)
              .eq("user_id", user.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        isPoll
          ? supabase
              .from("feed_poll_votes")
              .select("option_index")
              .eq("post_id", postId)
          : Promise.resolve({ data: null }),
      ]);

      const media: MediaAttachment[] = (mediaResult.data || []).map((m) => ({
        id: m.id,
        storage_path: m.storage_path,
        mime_type: m.mime_type,
        file_name: m.file_name,
      }));

      const meta = isPoll
        ? (((postData as { metadata?: unknown }).metadata as PollMetadata | null) ?? null)
        : null;
      const userVote =
        isPoll && userVoteResult.data
          ? (userVoteResult.data as { option_index: number }).option_index
          : null;
      const counts: number[] = new Array(meta?.options.length ?? 0).fill(0);
      let total = 0;
      if (isPoll && allVotesResult.data) {
        for (const v of allVotesResult.data as { option_index: number }[]) {
          if (v.option_index >= 0 && v.option_index < counts.length) {
            counts[v.option_index]++;
            total++;
          }
        }
      }

      const enrichedPost: FeedPost = {
        ...postData,
        author: (Array.isArray(postData.author)
          ? postData.author[0]
          : postData.author) as PostAuthor | null,
        liked_by_user: !!likeResult.data,
        media,
        ...(isPoll
          ? {
              poll_meta: meta,
              user_vote: userVote,
              vote_counts: counts,
              total_votes: total,
            }
          : {}),
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

  const votePoll = useCallback(
    async (optionIndex: number) => {
      const target = postRef.current;
      if (!postId || !target || !target.poll_meta) return;
      const meta = target.poll_meta;
      if (optionIndex < 0 || optionIndex >= meta.options.length) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const prevVote = target.user_vote ?? null;
      if (prevVote === optionIndex) return;
      if (prevVote !== null && !meta.allow_change) {
        showToast("Vote cannot be changed on this poll", "info");
        return;
      }

      const prevCounts = target.vote_counts ?? new Array(meta.options.length).fill(0);
      const prevTotal = target.total_votes ?? 0;

      const nextCounts = [...prevCounts];
      while (nextCounts.length < meta.options.length) nextCounts.push(0);
      if (prevVote !== null && prevVote < nextCounts.length) {
        nextCounts[prevVote] = Math.max(0, nextCounts[prevVote] - 1);
      }
      nextCounts[optionIndex]++;
      const nextTotal = prevVote !== null ? prevTotal : prevTotal + 1;

      setPost((p) =>
        p
          ? {
              ...p,
              user_vote: optionIndex,
              vote_counts: nextCounts,
              total_votes: nextTotal,
            }
          : p,
      );

      try {
        if (prevVote === null) {
          const { error: insertError } = await supabase.from("feed_poll_votes").insert({
            post_id: postId,
            user_id: user.id,
            organization_id: target.organization_id,
            option_index: optionIndex,
          });
          if (insertError) throw insertError;
        } else {
          const { error: updateError } = await supabase
            .from("feed_poll_votes")
            .update({ option_index: optionIndex, updated_at: new Date().toISOString() })
            .eq("post_id", postId)
            .eq("user_id", user.id);
          if (updateError) throw updateError;
        }
      } catch (e) {
        setPost((p) =>
          p
            ? {
                ...p,
                user_vote: prevVote,
                vote_counts: prevCounts,
                total_votes: prevTotal,
              }
            : p,
        );
        const message = (e as Error).message || "Failed to record vote";
        showToast(message, "error");
        sentry.captureException(e as Error, { context: "usePost.votePoll", postId });
      }
    },
    [postId],
  );

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
    votePoll,
  };
}
