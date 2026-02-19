import { GALLERY_ALLOWED_MIME_TYPES } from "@/lib/schemas/media";

const GALLERY_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const GALLERY_VIDEO_MAX_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_BATCH_SIZE = 20;

const HEIC_EXTENSIONS = new Set([".heic", ".heif"]);

interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a file for gallery upload.
 * Checks MIME type (with HEIC extension fallback) and file size.
 */
export function validateGalleryFile(file: File): ValidationResult {
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

  const isImage = mimeType.startsWith("image/");
  const maxBytes = isImage ? GALLERY_IMAGE_MAX_BYTES : GALLERY_VIDEO_MAX_BYTES;

  if (file.size > maxBytes) {
    return {
      valid: false,
      error: isImage ? "Images must be under 10 MB." : "Videos must be under 100 MB.",
    };
  }

  if (file.size === 0) {
    return { valid: false, error: "File is empty." };
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
