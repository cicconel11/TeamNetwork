export const MEDIA_FEATURES = ["feed_post", "discussion_thread", "job_posting", "gallery"] as const;
export type MediaFeature = (typeof MEDIA_FEATURES)[number];

export type MediaConstraints = {
  maxFileSize: number;
  allowedMimeTypes: Set<string>;
  maxAttachments: number;
};

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const IMAGE_AND_VIDEO_TYPES = new Set([...IMAGE_TYPES, ...VIDEO_TYPES]);

export const MEDIA_CONSTRAINTS: Record<MediaFeature, MediaConstraints> = {
  feed_post: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: IMAGE_AND_VIDEO_TYPES,
    maxAttachments: 4,
  },
  discussion_thread: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: IMAGE_TYPES,
    maxAttachments: 3,
  },
  job_posting: {
    maxFileSize: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: IMAGE_TYPES,
    maxAttachments: 1,
  },
  gallery: {
    maxFileSize: 20 * 1024 * 1024, // 20MB
    allowedMimeTypes: IMAGE_AND_VIDEO_TYPES,
    maxAttachments: 10,
  },
};

export function isImageMimeType(mimeType: string): boolean {
  return IMAGE_TYPES.has(mimeType);
}
