"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { createPostSchema } from "@/lib/schemas/feed";
import {
  prepareFeedImageEntries,
  type PreparedFeedImage,
} from "@/lib/media/feed-composer-prep";
import { MEDIA_CONSTRAINTS } from "@/lib/media/constants";
import { PollBuilder } from "./PollBuilder";

const MAX_IMAGES = MEDIA_CONSTRAINTS.feed_post.maxAttachments;

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

  // Image state — supports up to MAX_IMAGES files
  const [imageFiles, setImageFiles] = useState<PreparedFeedImage[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const previewUrlsRef = useRef<string[]>([]);

  // Poll state
  const [isPollMode, setIsPollMode] = useState(false);
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [pollAllowChange, setPollAllowChange] = useState(true);

  // Keep ref in sync so unmount cleanup revokes the latest URLs
  useEffect(() => {
    previewUrlsRef.current = previewUrls;
  }, [previewUrls]);

  // Revoke all preview URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Reset input so the same file(s) can be re-selected after removal
    if (fileInputRef.current) fileInputRef.current.value = "";

    const currentCount = imageFiles.length;
    const slotsAvailable = MAX_IMAGES - currentCount;

    if (slotsAvailable <= 0) {
      setError(`Maximum ${MAX_IMAGES} images per post`);
      return;
    }

    const { prepared, skipped } = await prepareFeedImageEntries({
      files,
      slotsAvailable,
    });

    if (skipped.length > 0) {
      setError(`Skipped: ${skipped.join("; ")}`);
    } else {
      setError(null);
    }

    if (prepared.length === 0) return;

    setImageFiles((prev) => [...prev, ...prepared]);
    setPreviewUrls((prev) => [...prev, ...prepared.map((f) => f.previewUrl)]);
  }, [imageFiles.length]);

  const removeImage = useCallback((index: number) => {
    setPreviewUrls((prev) => {
      const url = prev[index];
      if (url) URL.revokeObjectURL(url);
      return [...prev.slice(0, index), ...prev.slice(index + 1)];
    });
    setImageFiles((prev) => [...prev.slice(0, index), ...prev.slice(index + 1)]);
  }, []);

  const removeAllImages = useCallback(() => {
    setPreviewUrls((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url));
      return [];
    });
    setImageFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const uploadImage = async (file: PreparedFeedImage, index: number, total: number): Promise<string> => {
    setUploadProgress(`Uploading ${index + 1} of ${total}...`);
    const intentRes = await fetch("/api/media/upload-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId,
        feature: "feed_post",
        fileName: file.fileName,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        previewMimeType: file.previewMimeType,
        previewFileSize: file.previewFileSize || undefined,
      }),
    });

    if (!intentRes.ok) {
      const data = await intentRes.json();
      throw new Error(data.error || `Failed to prepare upload for ${file.fileName}`);
    }

    const { mediaId, signedUrl, previewSignedUrl } = await intentRes.json();

    const putRes = await fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": file.mimeType },
      body: file.file,
    });
    if (!putRes.ok) throw new Error(`Failed to upload ${file.fileName}`);

    if (previewSignedUrl && file.previewFile) {
      const previewPutRes = await fetch(previewSignedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.previewFile.type },
        body: file.previewFile,
      });
      if (!previewPutRes.ok) throw new Error(`Failed to upload preview for ${file.fileName}`);
    }

    setUploadProgress(`Finalizing ${index + 1} of ${total}...`);
    const finalizeRes = await fetch("/api/media/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, mediaId }),
    });

    if (!finalizeRes.ok) {
      const data = await finalizeRes.json();
      throw new Error(data.error || `Failed to finalize ${file.fileName}`);
    }

    return mediaId;
  };

  const togglePollMode = useCallback(() => {
    setIsPollMode((prev) => {
      if (!prev) {
        // Entering poll mode — clear all images
        removeAllImages();
      } else {
        // Leaving poll mode — reset poll state
        setPollOptions(["", ""]);
        setPollAllowChange(true);
      }
      return !prev;
    });
  }, [removeAllImages]);

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
      if (!isPollMode && imageFiles.length > 0) {
        // Upload sequentially for clear progress feedback
        for (let i = 0; i < imageFiles.length; i++) {
          const mediaId = await uploadImage(imageFiles[i], i, imageFiles.length);
          mediaIds = [...mediaIds, mediaId];
        }
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
      removeAllImages();
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

  const canAddMoreImages = !isPollMode && imageFiles.length < MAX_IMAGES;

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

        {/* Image previews */}
        {!isPollMode && previewUrls.length > 0 && (
          <div className={`mt-3 gap-1.5 ${previewUrls.length === 1 ? "flex" : "grid grid-cols-2"}`}>
            {previewUrls.map((url, index) => (
              <div key={url} className={`relative ${previewUrls.length === 1 ? "inline-block" : "aspect-square"}`}>
                <div className={`rounded-xl overflow-hidden ring-1 ring-border shadow-sm ${previewUrls.length === 1 ? "" : "h-full"}`}>
                  <Image
                    src={url}
                    alt={`Upload preview ${index + 1}`}
                    width={300}
                    height={200}
                    className={`object-cover ${previewUrls.length === 1 ? "max-h-52 w-auto" : "w-full h-full"}`}
                    unoptimized
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  className="absolute top-2 right-2 bg-foreground/80 backdrop-blur-sm text-background rounded-full w-7 h-7 flex items-center justify-center text-xs font-medium hover:bg-foreground transition-all duration-200 shadow-lg"
                  aria-label={`Remove image ${index + 1}`}
                >
                  ✕
                </button>
              </div>
            ))}
            {canAddMoreImages && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="aspect-square rounded-xl border-2 border-dashed border-border/60 hover:border-border hover:bg-muted/40 transition-all duration-200 flex flex-col items-center justify-center gap-1 text-muted-foreground"
                aria-label="Add more images"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span className="text-xs">{MAX_IMAGES - imageFiles.length} left</span>
              </button>
            )}
          </div>
        )}

        {/* Upload progress */}
        {uploadProgress && (
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-2">
            <div className="h-1 flex-1 bg-org-secondary/20 rounded-full overflow-hidden">
              <div className="h-full bg-org-secondary rounded-full animate-pulse" style={{ width: "60%" }} />
            </div>
            <span>{uploadProgress}</span>
          </div>
        )}

        {/* Action bar */}
        <div className="flex items-center justify-between border-t border-border/60 pt-2.5 mt-3">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => { if (canAddMoreImages) fileInputRef.current?.click(); }}
              className={`p-2 rounded-xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${!canAddMoreImages ? "text-muted-foreground/30 cursor-not-allowed" : "text-muted-foreground hover:text-org-secondary hover:bg-org-secondary/10"}`}
              aria-label="Add image"
              disabled={isSubmitting || !canAddMoreImages}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
              </svg>
            </button>
            {imageFiles.length > 0 && !isPollMode && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {imageFiles.length}/{MAX_IMAGES}
              </span>
            )}
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
