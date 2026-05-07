import { GALLERY_ALLOWED_MIME_TYPES } from "@/lib/schemas/media";

export const GALLERY_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10MB
export const GALLERY_RAW_IMAGE_MAX_BYTES = 50 * 1024 * 1024; // 50MB
export const GALLERY_VIDEO_MAX_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_BATCH_SIZE = 100;

const HEIC_EXTENSIONS = new Set([".heic", ".heif"]);

interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Raw-time validation for a gallery upload candidate, run BEFORE any
 * client-side normalization (`prepareImageUpload`).
 *
 * Responsibilities:
 *  - mime type allowlist (with HEIC extension fallback)
 *  - explicit HEIC rejection (no browser conversion support yet)
 *  - empty-file check
 *  - video raw-size cap (100 MB) — videos are uploaded as-is
 *
 * Image size is intentionally NOT checked here: iPhone JPEGs can be 14 MB raw
 * but compress to well under 1 MB after `prepareImageUpload`. Use
 * `validateGalleryPreparedSize` after prep for images.
 */
export function validateGalleryRawFile(file: File): ValidationResult {
  let mimeType = file.type;

  // HEIC fallback: some browsers report empty file.type for HEIC files
  if (!mimeType) {
    const ext = getExtension(file.name);
    if (HEIC_EXTENSIONS.has(ext)) {
      mimeType = "image/heic";
    }
  }

  if (!GALLERY_ALLOWED_MIME_TYPES.has(mimeType)) {
    return {
      valid: false,
      error: "Unsupported file type. Accepted: JPG, PNG, WebP, HEIC, MP4, MOV, WebM.",
    };
  }

  if (mimeType === "image/heic") {
    return {
      valid: false,
      error: "HEIC uploads are not supported in the browser yet. Convert to JPG, PNG, or WebP first.",
    };
  }

  if (file.size === 0) {
    return { valid: false, error: "File is empty." };
  }

  if (mimeType.startsWith("image/") && file.size > GALLERY_RAW_IMAGE_MAX_BYTES) {
    return { valid: false, error: "Images must be under 50 MB before upload." };
  }

  // Videos are uploaded as-is, so cap the raw size here. Images are checked
  // post-prep via `validateGalleryPreparedSize`.
  if (!mimeType.startsWith("image/") && file.size > GALLERY_VIDEO_MAX_BYTES) {
    return { valid: false, error: "Videos must be under 100 MB." };
  }

  return { valid: true };
}

/**
 * Post-prep validation for an image that has already been run through
 * `prepareImageUpload`. Enforces the 10 MB image cap against the
 * normalized bytes (what the server will actually store).
 *
 * No-op for non-image mime types (video caps are enforced raw-time).
 */
export function validateGalleryPreparedSize(
  preparedBytes: number,
  mimeType: string,
): ValidationResult {
  if (!mimeType.startsWith("image/")) {
    return { valid: true };
  }
  if (preparedBytes > GALLERY_IMAGE_MAX_BYTES) {
    return { valid: false, error: "Images must be under 10 MB." };
  }
  return { valid: true };
}

/**
 * Derive a default title from a filename by stripping the extension and trimming.
 */
export function deriveDefaultTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim();
}

/**
 * Detect duplicate files by matching name + size against existing entries.
 *
 * IMPORTANT: callers must pass the RAW file's name and size, and `existing`
 * must be built from the raw (`originalName`/`originalSize`) fields — not
 * from post-prep `fileName`/`fileSize`. `prepareImageUpload` rewrites
 * `.jpeg` → `.jpg` and shrinks the byte count, so keying dedupe off post-prep
 * values silently breaks cross-batch dedupe.
 */
export function detectDuplicate(
  file: File,
  existing: { name: string; size: number }[],
): boolean {
  return existing.some((e) => e.name === file.name && e.size === file.size);
}

/**
 * Resolve the effective MIME type, applying HEIC extension fallback.
 */
export function resolveGalleryMimeType(file: File): string {
  if (file.type) return file.type;
  const ext = getExtension(file.name);
  if (HEIC_EXTENSIONS.has(ext)) return "image/heic";
  return "";
}

/**
 * Check whether a batch of files exceeds the max batch limit.
 */
export function checkBatchLimit(count: number): ValidationResult {
  if (count > MAX_BATCH_SIZE) {
    return {
      valid: false,
      error: `Maximum ${MAX_BATCH_SIZE} files per batch.`,
    };
  }
  return { valid: true };
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "";
  return name.slice(dot).toLowerCase();
}
