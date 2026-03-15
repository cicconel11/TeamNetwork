"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createPostSchema } from "@/lib/schemas/feed";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

interface FeedComposerProps {
  orgId: string;
}

export function FeedComposer({ orgId }: FeedComposerProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Image state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = createPostSchema.safeParse({ body });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    setIsSubmitting(true);

    try {
      let mediaIds: string[] = [];
      if (imageFile) {
        const mediaId = await uploadImage(imageFile);
        if (mediaId) mediaIds = [mediaId];
      }

      setUploadProgress(null);

      const response = await fetch("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, body, mediaIds }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || "Failed to create post");
        setIsSubmitting(false);
        return;
      }

      setBody("");
      removeImage();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

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

        {/* Image preview */}
        {previewUrl && (
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
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-xl text-muted-foreground hover:text-org-secondary hover:bg-org-secondary/10 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              aria-label="Add image"
              disabled={isSubmitting}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
              </svg>
            </button>
          </div>
          <Button type="submit" disabled={isSubmitting || !body.trim()}>
            {isSubmitting ? (uploadProgress || "Posting...") : "Post"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
