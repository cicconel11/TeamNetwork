"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { relativeTime } from "@/lib/utils/relative-time";
import { createCommentSchema } from "@/lib/schemas/feed";
import type { CommentWithAuthor } from "./types";

interface InlineCommentsProps {
  postId: string;
  commentCount: number;
  currentUserId: string;
  orgSlug: string;
  onCountChange: (count: number | ((prev: number) => number)) => void;
}

const INITIAL_DISPLAY = 3;

export function InlineComments({ postId, commentCount, currentUserId, orgSlug, onCountChange }: InlineCommentsProps) {
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchComments() {
      try {
        const res = await fetch(`/api/feed/${postId}/comments`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setComments(data.comments);
          onCountChange(data.total);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) setIsLoading(false);
      }
    }
    fetchComments();
    return () => { cancelled = true; };
  }, [postId, onCountChange]);

  useEffect(() => {
    if (!isLoading && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isLoading]);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.style.height = "auto";
      editRef.current.style.height = `${Math.min(editRef.current.scrollHeight, 120)}px`;
    }
  }, [editingId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = createCommentSchema.safeParse({ body });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    setIsSubmitting(true);

    const optimistic: CommentWithAuthor = {
      id: `optimistic-${Date.now()}`,
      post_id: postId,
      author_id: currentUserId,
      organization_id: "",
      body: body.trim(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
      author: { name: "You" },
    };

    setComments((prev) => [...prev, optimistic]);
    onCountChange((prev) => prev + 1);
    const submittedBody = body;
    setBody("");

    try {
      const res = await fetch(`/api/feed/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: submittedBody }),
      });

      if (!res.ok) {
        const result = await res.json();
        setError(result.error || "Failed to post comment");
        setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
        onCountChange((prev) => prev - 1);
        setBody(submittedBody);
      } else {
        const result = await res.json();
        setComments((prev) =>
          prev.map((c) =>
            c.id === optimistic.id
              ? { ...result.data, author: { name: "You" } }
              : c,
          ),
        );
      }
    } catch {
      setError("An unexpected error occurred");
      setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
      onCountChange((prev) => prev - 1);
      setBody(submittedBody);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    const original = comments.find((c) => c.id === commentId);
    if (!original) return;

    // Optimistic remove
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    onCountChange((prev) => prev - 1);

    try {
      const res = await fetch(`/api/feed/${postId}/comments/${commentId}`, { method: "DELETE" });
      if (!res.ok) {
        // Roll back
        setComments((prev) => [...prev, original].sort((a, b) => a.created_at.localeCompare(b.created_at)));
        onCountChange((prev) => prev + 1);
        setError("Failed to delete comment");
      }
    } catch {
      setComments((prev) => [...prev, original].sort((a, b) => a.created_at.localeCompare(b.created_at)));
      onCountChange((prev) => prev + 1);
      setError("Failed to delete comment");
    }
  };

  const handleEditSave = async (commentId: string) => {
    const parsed = createCommentSchema.safeParse({ body: editBody });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    const original = comments.find((c) => c.id === commentId);
    if (!original) return;

    // Optimistic update
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, body: editBody.trim() } : c)),
    );
    setEditingId(null);

    try {
      const res = await fetch(`/api/feed/${postId}/comments/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: editBody.trim() }),
      });
      if (!res.ok) {
        // Roll back
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? original : c)),
        );
        setError("Failed to edit comment");
      }
    } catch {
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? original : c)),
      );
      setError("Failed to edit comment");
    }
  };

  const startEditing = (comment: CommentWithAuthor) => {
    setEditingId(comment.id);
    setEditBody(comment.body);
    setError(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditBody("");
  };

  const displayedComments = comments.slice(-INITIAL_DISPLAY);
  const hasMore = commentCount > INITIAL_DISPLAY && comments.length > INITIAL_DISPLAY;

  return (
    <div className="pt-3 border-t border-border/40">
      {isLoading ? (
        <div className="space-y-3 px-1">
          {Array.from({ length: Math.min(commentCount, 2) }).map((_, i) => (
            <div key={i} className="flex gap-2 animate-pulse">
              <div className="h-6 w-6 rounded-full bg-muted shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-24 bg-muted rounded" />
                <div className="h-3 w-48 bg-muted rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {hasMore && (
            <Link
              href={`/${orgSlug}/feed/${postId}`}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-1"
            >
              View all {commentCount} comments
            </Link>
          )}

          {displayedComments.map((comment) => {
            const isOwn = comment.author_id === currentUserId;
            const isEditing = editingId === comment.id;

            return (
              <div key={comment.id} className="flex gap-2 px-1 group/comment">
                <Avatar name={comment.author?.name || "Unknown"} size="sm" className="!h-6 !w-6 !text-[10px] mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        ref={editRef}
                        value={editBody}
                        onChange={(e) => {
                          setEditBody(e.target.value);
                          e.target.style.height = "auto";
                          e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            if (editBody.trim()) handleEditSave(comment.id);
                          }
                          if (e.key === "Escape") cancelEditing();
                        }}
                        maxLength={2000}
                        rows={1}
                        className="w-full resize-none rounded-2xl border border-border/60 bg-muted/20 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:border-transparent transition-all"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEditSave(comment.id)}
                          disabled={!editBody.trim()}
                          className="text-xs font-medium text-org-primary hover:text-org-primary/80 disabled:opacity-50 transition-colors"
                          type="button"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="bg-muted/40 rounded-2xl px-3 py-2">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-xs font-semibold text-foreground">{comment.author?.name || "Unknown"}</span>
                          <span className="text-[10px] text-muted-foreground/60 font-mono">{relativeTime(comment.created_at)}</span>
                        </div>
                        <p className="text-sm text-foreground/90 whitespace-pre-wrap mt-0.5 leading-snug">{comment.body}</p>
                      </div>
                      {isOwn && (
                        <div className="flex gap-3 mt-0.5 ml-2 opacity-0 group-hover/comment:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEditing(comment)}
                            className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(comment.id)}
                            className="text-[11px] font-medium text-muted-foreground hover:text-red-500 transition-colors"
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {comments.length === 0 && !isLoading && (
            <p className="text-xs text-muted-foreground px-1">No comments yet. Be the first!</p>
          )}
        </div>
      )}

      {/* Comment input */}
      <form onSubmit={handleSubmit} className="mt-3 flex gap-2 items-start px-1">
        <Avatar name="You" size="sm" className="!h-6 !w-6 !text-[10px] mt-1 shrink-0" />
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (body.trim() && !isSubmitting) {
                  handleSubmit(e);
                }
              }
            }}
            placeholder="Write a comment..."
            maxLength={2000}
            rows={1}
            className="w-full resize-none rounded-full border border-border/60 bg-muted/20 px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:border-transparent transition-all"
          />
          {body.trim() && (
            <button
              type="submit"
              disabled={isSubmitting}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-org-primary hover:bg-org-primary/10 disabled:opacity-50 transition-colors"
              aria-label="Send comment"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </button>
          )}
        </div>
      </form>

      {error && (
        <p className="text-xs text-red-500 mt-1.5 px-9">{error}</p>
      )}
    </div>
  );
}
