"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { createPostSchema } from "@/lib/schemas/feed";
import { PollBuilder } from "./PollBuilder";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

interface FeedComposerProps {
  orgId: string;
  userName?: string;
}

export function FeedComposer({ orgId, userName }: FeedComposerProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Image state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // Poll state
  const [isPollMode, setIsPollMode] = useState(false);
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [pollAllowChange, setPollAllowChange] = useState(true);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_TYPES.has(file.type)) {
      setError("Only JPEG, PNG, WebP, and GIF images are supported");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError("Image must be under 10MB");
      return;
    }

    setError(null);
    setImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }, []);

  const removeImage = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setImageFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [previewUrl]);

  const uploadImage = async (file: File): Promise<string | null> => {
    setUploadProgress("Preparing upload...");
    const intentRes = await fetch("/api/media/upload-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId,
        feature: "feed_post",
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      }),
    });

    if (!intentRes.ok) {
      const data = await intentRes.json();
      throw new Error(data.error || "Failed to prepare upload");
    }

    const { mediaId, signedUrl } = await intentRes.json();

    setUploadProgress("Uploading image...");
    const putRes = await fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!putRes.ok) throw new Error("Failed to upload image");

    setUploadProgress("Finalizing...");
    const finalizeRes = await fetch("/api/media/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, mediaId }),
    });

    if (!finalizeRes.ok) {
      const data = await finalizeRes.json();
      throw new Error(data.error || "Failed to finalize upload");
    }

    return mediaId;
  };

  const togglePollMode = useCallback(() => {
    setIsPollMode((prev) => {
      if (!prev) {
        // Entering poll mode — clear image
        removeImage();
      } else {
        // Leaving poll mode — reset poll state
        setPollOptions(["", ""]);
        setPollAllowChange(true);
      }
      return !prev;
    });
  }, [removeImage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const pollPayload = isPollMode
      ? { question: "", options: pollOptions, allow_change: pollAllowChange }
      : undefined;

    const parsed = createPostSchema.safeParse({ body, poll: pollPayload });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    setIsSubmitting(true);

    try {
      let mediaIds: string[] = [];
      if (!isPollMode && imageFile) {
        const mediaId = await uploadImage(imageFile);
        if (mediaId) mediaIds = [mediaId];
      }

      setUploadProgress(null);

      const payload: Record<string, unknown> = { orgId, body, mediaIds };
      if (pollPayload) {
        payload.poll = pollPayload;
      }

      const response = await fetch("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || "Failed to create post");
        setIsSubmitting(false);
        return;
      }

      setBody("");
      removeImage();
      if (isPollMode) {
        setIsPollMode(false);
        setPollOptions(["", ""]);
        setPollAllowChange(true);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  if (!isExpanded) {
    return (
      <Card className="px-4 py-3">
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-3 w-full text-left"
        >
          <Avatar name={userName || "You"} size="sm" className="shrink-0" />
          <div className="flex-1 px-4 py-2.5 rounded-full bg-muted/60 hover:bg-muted transition-colors text-sm text-muted-foreground">
            What&apos;s on your mind?
          </div>
        </button>
      </Card>
    );
  }

  return (
    <Card className="px-4 pt-4 pb-3">
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="p-3 mb-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-800 dark:text-red-300 text-sm" role="alert">
            {error}
          </div>
        )}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What's on your mind?"
          rows={2}
          maxLength={5000}
          className="w-full resize-none border-0 bg-transparent p-0 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0 min-h-[44px] max-h-48 overflow-y-auto leading-relaxed"
          aria-label="Compose a post"
        />

        {/* Poll builder */}
        {isPollMode && (
          <PollBuilder
            options={pollOptions}
            onOptionsChange={setPollOptions}
            allowChange={pollAllowChange}
            onAllowChangeToggle={setPollAllowChange}
          />
        )}

        {/* Image preview */}
        {!isPollMode && previewUrl && (
          <div className="relative inline-block mt-3">
            <div className="rounded-xl overflow-hidden ring-1 ring-border shadow-sm">
              <Image
                src={previewUrl}
                alt="Upload preview"
                width={300}
                height={200}
                className="object-cover max-h-52 w-auto"
                unoptimized
              />
            </div>
            <button
              type="button"
              onClick={removeImage}
              className="absolute top-2 right-2 bg-foreground/80 backdrop-blur-sm text-background rounded-full w-7 h-7 flex items-center justify-center text-xs font-medium hover:bg-foreground transition-all duration-200 shadow-lg"
              aria-label="Remove image"
            >
              ✕
            </button>
            {uploadProgress && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-org-secondary/20 rounded-b-xl overflow-hidden">
                <div className="h-full bg-org-secondary rounded-full animate-pulse" style={{ width: "60%" }} />
              </div>
            )}
          </div>
        )}

        {/* Action bar */}
        <div className="flex items-center justify-between border-t border-border/60 pt-2.5 mt-3">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => { if (!isPollMode) fileInputRef.current?.click(); }}
              className={`p-2 rounded-xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${isPollMode ? "text-muted-foreground/30 cursor-not-allowed" : "text-muted-foreground hover:text-org-secondary hover:bg-org-secondary/10"}`}
              aria-label="Add image"
              disabled={isSubmitting || isPollMode}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={togglePollMode}
              className={`p-2 rounded-xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${isPollMode ? "text-org-primary bg-org-primary/10" : "text-muted-foreground hover:text-org-primary hover:bg-org-primary/10"}`}
              aria-label={isPollMode ? "Remove poll" : "Add poll"}
              disabled={isSubmitting}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </button>
          </div>
          <Button type="submit" disabled={isSubmitting || (!body.trim() && !(isPollMode && pollOptions.some((o) => o.trim())))}>
            {isSubmitting ? (uploadProgress || "Posting...") : isPollMode ? "Post Poll" : "Post"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
