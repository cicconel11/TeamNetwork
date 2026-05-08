import { useState, useRef, useCallback } from "react";
import { fetchWithAuth } from "@/lib/web-api";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";
import { supabase } from "@/lib/supabase";
import {
  MAX_UPLOAD_FILE_SIZE_BYTES,
  readArrayBufferFromUri,
  validateFileSize,
  validateMimeType,
} from "@/lib/uploads";

const STORAGE_BUCKET = "org-media";

export type UploadStatus = "idle" | "uploading" | "done" | "error";

export interface PendingImage {
  readonly localUri: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly fileSize: number;
  readonly status: UploadStatus;
  readonly mediaId: string | null;
  readonly error: string | null;
}

const MAX_IMAGES = 4;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** Validates a picked image asset. Returns error string or null if valid. */
export function validatePickedImage(asset: {
  mimeType?: string | null;
  fileSize?: number | null;
}): string | null {
  return (
    validateMimeType(
      asset.mimeType,
      ALLOWED_MIME_TYPES,
      "Only JPEG, PNG, WebP, and GIF images are supported"
    ) ??
    validateFileSize(asset.fileSize, {
      maxBytes: MAX_UPLOAD_FILE_SIZE_BYTES,
      message: "Image must be under 10MB",
    })
  );
}

interface ImagePickerAsset {
  readonly uri: string;
  readonly fileName?: string | null;
  readonly mimeType?: string | null;
  readonly fileSize?: number | null;
}

export function useMediaUpload(orgId: string | null) {
  const [images, setImages] = useState<readonly PendingImage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const isMountedRef = useRef(true);

  // Track mount state
  const setMountedRef = useCallback((mounted: boolean) => {
    isMountedRef.current = mounted;
  }, []);

  const addImages = useCallback(
    (assets: readonly ImagePickerAsset[]) => {
      setImages((prev) => {
        const slotsAvailable = MAX_IMAGES - prev.length;
        if (slotsAvailable <= 0) {
          showToast(`Maximum ${MAX_IMAGES} images allowed`, "error");
          return prev;
        }

        const validAssets: PendingImage[] = [];
        for (const asset of assets.slice(0, slotsAvailable)) {
          const validationError = validatePickedImage(asset);
          if (validationError) {
            showToast(validationError, "error");
            continue;
          }
          validAssets.push({
            localUri: asset.uri,
            fileName: asset.fileName ?? `image_${Date.now()}.jpg`,
            mimeType: asset.mimeType ?? "image/jpeg",
            fileSize: asset.fileSize ?? 0,
            status: "idle",
            mediaId: null,
            error: null,
          });
        }

        if (validAssets.length === 0) return prev;
        return [...prev, ...validAssets];
      });
    },
    []
  );

  const removeImage = useCallback((localUri: string) => {
    setImages((prev) => prev.filter((img) => img.localUri !== localUri));
  }, []);

  const reset = useCallback(() => {
    setImages([]);
    setIsUploading(false);
  }, []);

  const uploadAll = useCallback(async (): Promise<string[]> => {
    if (!orgId || images.length === 0) return [];

    setIsUploading(true);
    const mediaIds: string[] = [];

    try {
      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        if (image.status === "done" && image.mediaId) {
          mediaIds.push(image.mediaId);
          continue;
        }

        // Update status to uploading
        if (isMountedRef.current) {
          setImages((prev) =>
            prev.map((img, idx) =>
              idx === i ? { ...img, status: "uploading" as const, error: null } : img
            )
          );
        }

        try {
          // Step 1: Get signed upload URL
          const intentRes = await fetchWithAuth("/api/media/upload-intent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orgId,
              feature: "feed_post",
              fileName: image.fileName,
              mimeType: image.mimeType,
              fileSize: image.fileSize,
            }),
          });

          if (!intentRes.ok) {
            const data = await intentRes.json();
            throw new Error(data.error || "Failed to prepare upload");
          }

          const { mediaId, path, token } = await intentRes.json();

          // Step 2: Upload file bytes to storage via the signed upload URL.
          // Use supabase-js's uploadToSignedUrl (not raw PUT) so the required
          // x-upsert header and content-type are set correctly. Read bytes
          // via readArrayBufferFromUri because RN's fetch(file://).blob()
          // returns a 0-byte Blob on iOS.
          const bytes = await readArrayBufferFromUri(image.localUri);
          const { error: uploadError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .uploadToSignedUrl(path, token, bytes, {
              contentType: image.mimeType,
              upsert: false,
            });
          if (uploadError) {
            throw new Error(uploadError.message || "Failed to upload file to storage");
          }

          // Step 3: Finalize upload (magic bytes validation)
          const finalizeRes = await fetchWithAuth("/api/media/finalize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orgId, mediaId }),
          });

          if (!finalizeRes.ok) {
            const data = await finalizeRes.json();
            throw new Error(data.error || "Failed to finalize upload");
          }

          // Success
          mediaIds.push(mediaId);
          if (isMountedRef.current) {
            setImages((prev) =>
              prev.map((img, idx) =>
                idx === i
                  ? { ...img, status: "done" as const, mediaId }
                  : img
              )
            );
          }
        } catch (e) {
          const message = (e as Error).message || "Upload failed";
          console.warn("[useMediaUpload] upload failed", { imageIndex: i, message, error: e });
          showToast(`Upload failed: ${message}`, "error");
          if (isMountedRef.current) {
            setImages((prev) =>
              prev.map((img, idx) =>
                idx === i
                  ? { ...img, status: "error" as const, error: message }
                  : img
              )
            );
          }
          sentry.captureException(e as Error, {
            context: "useMediaUpload.uploadAll",
            orgId,
            imageIndex: i,
          });
        }
      }
    } finally {
      if (isMountedRef.current) {
        setIsUploading(false);
      }
    }

    return mediaIds;
  }, [orgId, images]);

  return {
    images,
    isUploading,
    addImages,
    removeImage,
    uploadAll,
    reset,
    setMountedRef,
  } as const;
}
