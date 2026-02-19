import { MEDIA_CONSTRAINTS, type MediaFeature } from "./constants";

/**
 * Magic byte signatures for validating file content matches declared MIME type.
 * Prevents MIME type spoofing attacks.
 *
 * Extracted from branding route for shared use across media uploads.
 */
const MAGIC_BYTES: Record<string, { offset: number; signatures: number[][]; extra?: (buf: Buffer) => boolean }> = {
  "image/png": {
    offset: 0,
    signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  },
  "image/jpeg": {
    offset: 0,
    signatures: [[0xff, 0xd8, 0xff]],
  },
  "image/jpg": {
    offset: 0,
    signatures: [[0xff, 0xd8, 0xff]],
  },
  "image/gif": {
    offset: 0,
    signatures: [
      [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
      [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
    ],
  },
  "image/webp": {
    offset: 0,
    signatures: [[0x52, 0x49, 0x46, 0x46]], // RIFF header
    extra: (buf) => {
      if (buf.length < 12) return false;
      // Verify WEBP signature at offset 8
      const webpSig = [0x57, 0x45, 0x42, 0x50];
      return webpSig.every((byte, i) => buf[8 + i] === byte);
    },
  },
  "image/heic": {
    offset: 4,
    signatures: [
      [0x66, 0x74, 0x79, 0x70], // "ftyp" at offset 4 (HEIC uses ftyp box like MP4/MOV)
    ],
    extra: (buf) => {
      if (buf.length < 12) return false;
      // Check for HEIC brand codes at offset 8: "heic", "heix", "mif1"
      const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
      return ["heic", "heix", "mif1"].includes(brand);
    },
  },
  "video/mp4": {
    offset: 4,
    signatures: [
      [0x66, 0x74, 0x79, 0x70], // "ftyp" at offset 4
    ],
  },
  "video/quicktime": {
    offset: 4,
    signatures: [
      [0x66, 0x74, 0x79, 0x70], // "ftyp" at offset 4 (QuickTime also uses ftyp)
    ],
  },
  "video/webm": {
    offset: 0,
    signatures: [
      [0x1a, 0x45, 0xdf, 0xa3], // EBML header
    ],
  },
};

/**
 * Validates that the file content matches its declared MIME type by checking magic bytes.
 * Returns true if the buffer's leading bytes match the expected signature.
 */
export function validateMagicBytes(buffer: Buffer, declaredType: string): boolean {
  const config = MAGIC_BYTES[declaredType];
  if (!config) return false;

  for (const signature of config.signatures) {
    const start = config.offset;
    if (buffer.length < start + signature.length) continue;

    const matches = signature.every((byte, i) => buffer[start + i] === byte);
    if (matches) {
      // Run extra validation if defined (e.g. WebP's secondary check)
      if (config.extra) return config.extra(buffer);
      return true;
    }
  }

  return false;
}

/**
 * Validates a file against the constraints for a given feature.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateFileConstraints(
  feature: MediaFeature,
  mimeType: string,
  fileSize: number,
): string | null {
  const constraints = MEDIA_CONSTRAINTS[feature];

  if (!constraints.allowedMimeTypes.has(mimeType)) {
    return `File type "${mimeType}" is not allowed for ${feature.replace("_", " ")}`;
  }

  if (fileSize > constraints.maxFileSize) {
    const maxMB = Math.round(constraints.maxFileSize / (1024 * 1024));
    return `File size exceeds the ${maxMB}MB limit for ${feature.replace("_", " ")}`;
  }

  return null;
}
