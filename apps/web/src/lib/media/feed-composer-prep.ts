import {
  prepareImageUpload,
  type PreparedImageUpload,
} from "@/lib/media/image-preparation";
import { MEDIA_CONSTRAINTS } from "@/lib/media/constants";
import { GALLERY_RAW_IMAGE_MAX_BYTES } from "@/lib/media/gallery-validation";

/**
 * Single source of truth for the feed-post upload size cap. Imported by
 * `FeedComposer` and used as the post-prep gate inside
 * `prepareFeedImageEntries`.
 */
export const FEED_POST_MAX_FILE_SIZE = MEDIA_CONSTRAINTS.feed_post.maxFileSize;

const MAX_IMAGES = MEDIA_CONSTRAINTS.feed_post.maxAttachments;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const GIF87A_HEADER = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A_HEADER = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

export interface PreparedFeedImage {
  file: File;
  previewFile: File | null;
  previewUrl: string;
  fileName: string;
  fileSize: number;
  previewFileSize: number;
  mimeType: string;
  previewMimeType: string | null;
}

export interface PrepareFeedImagesInput {
  files: File[];
  /** Number of additional images the composer can still accept this batch. */
  slotsAvailable: number;
  /** Injectable for tests; defaults to the real `prepareImageUpload`. */
  prepareImage?: (file: File) => Promise<PreparedImageUpload>;
  /** Injectable for tests; defaults to `URL.createObjectURL`. */
  createObjectUrl?: (file: File | Blob) => string;
  /** Injectable for tests; defaults to `URL.revokeObjectURL`. */
  revokeObjectUrl?: (url: string) => void;
}

export interface PrepareFeedImagesResult {
  prepared: PreparedFeedImage[];
  /** Human-readable rejection messages, one per skipped file. */
  skipped: string[];
}

function matchesHeader(bytes: Uint8Array, header: number[]): boolean {
  return header.every((byte, index) => bytes[index] === byte);
}

async function sniffGifHeader(file: File): Promise<"valid" | "empty" | "invalid"> {
  if (file.size === 0) {
    return "empty";
  }

  const header = new Uint8Array(await file.slice(0, 6).arrayBuffer());
  if (header.length < 6) {
    return "invalid";
  }

  if (matchesHeader(header, GIF87A_HEADER) || matchesHeader(header, GIF89A_HEADER)) {
    return "valid";
  }

  return "invalid";
}

/**
 * Pure async helper that walks a batch of user-selected feed images, runs
 * raw mime check → prep (for non-GIF images) → post-prep size validation,
 * and returns the prepared entries plus any rejection messages.
 *
 * Validation order is load-bearing: image size MUST be checked AFTER prep so
 * that a 14 MB iPhone JPEG (which compresses to ~600 KB) is not rejected on
 * its raw byte count.
 *
 * GIFs are passed through without prep — animated GIFs would lose animation
 * if re-encoded — so the size cap is enforced raw-time for them.
 */
export async function prepareFeedImageEntries(
  input: PrepareFeedImagesInput,
): Promise<PrepareFeedImagesResult> {
  const {
    files,
    slotsAvailable,
    prepareImage = prepareImageUpload,
    createObjectUrl = (f) => URL.createObjectURL(f),
    revokeObjectUrl = (url) => URL.revokeObjectURL(url),
  } = input;

  const prepared: PreparedFeedImage[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (prepared.length >= slotsAvailable) {
      skipped.push(`${file.name}: maximum ${MAX_IMAGES} images reached`);
      continue;
    }

    if (!ACCEPTED_TYPES.has(file.type)) {
      skipped.push(`${file.name}: only JPEG, PNG, WebP, and GIF supported`);
      continue;
    }

    if (file.size > GALLERY_RAW_IMAGE_MAX_BYTES) {
      skipped.push(`${file.name}: must be under 50MB before upload`);
      continue;
    }

    // GIFs are passed through without prep so animation is preserved.
    // Their size cap is enforced raw-time.
    if (file.type === "image/gif") {
      const gifHeaderStatus = await sniffGifHeader(file);
      if (gifHeaderStatus === "empty") {
        skipped.push(`${file.name}: file is empty`);
        continue;
      }
      if (gifHeaderStatus === "invalid") {
        skipped.push(`${file.name}: invalid GIF header`);
        continue;
      }
      if (file.size > FEED_POST_MAX_FILE_SIZE) {
        skipped.push(`${file.name}: must be under 10MB`);
        continue;
      }
      prepared.push({
        file,
        previewFile: null,
        previewUrl: createObjectUrl(file),
        fileName: file.name,
        fileSize: file.size,
        previewFileSize: 0,
        mimeType: file.type,
        previewMimeType: null,
      });
      continue;
    }

    // Re-encoded images: prep first, then enforce the post-prep size cap.
    let preparedImage: PreparedImageUpload;
    try {
      preparedImage = await prepareImage(file);
      console.log("[media/upload] prepared feed image", {
        fileName: file.name,
        originalBytes: preparedImage.originalBytes,
        normalizedBytes: preparedImage.normalizedBytes,
      });
    } catch (err) {
      skipped.push(
        `${file.name}: ${err instanceof Error ? err.message : "failed to prepare image upload"}`,
      );
      continue;
    }

    if (preparedImage.file.size > FEED_POST_MAX_FILE_SIZE) {
      // Revoke the prep-generated preview URL — we will not be using it.
      if (preparedImage.previewUrl) revokeObjectUrl(preparedImage.previewUrl);
      skipped.push(`${file.name}: must be under 10MB`);
      continue;
    }

    prepared.push({
      file: preparedImage.file,
      previewFile: preparedImage.previewFile,
      previewUrl: preparedImage.previewUrl || createObjectUrl(preparedImage.file),
      fileName: preparedImage.file.name,
      fileSize: preparedImage.file.size,
      previewFileSize: preparedImage.previewFile?.size ?? 0,
      mimeType: preparedImage.mimeType,
      previewMimeType: preparedImage.previewMimeType,
    });
  }

  return { prepared, skipped };
}
