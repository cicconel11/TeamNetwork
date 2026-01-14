import { z } from "zod";
import { baseSchemas, safeString } from "@/lib/security/validation";
import { optionalSafeString, optionalHttpsUrlSchema } from "./common";

export const mediaTypeSchema = z.enum(["image", "video"]);
export type MediaType = z.infer<typeof mediaTypeSchema>;

export const mediaVisibilitySchema = z.enum(["all", "members_only", "admin_only"]);
export type MediaVisibility = z.infer<typeof mediaVisibilitySchema>;

const mediaTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(
    /^[a-zA-Z0-9\s\-_]+$/,
    "Tags: letters, numbers, spaces, hyphens, underscores only"
  );

export const mediaTagsSchema = z.array(mediaTagSchema).max(20).default([]);

export const createMediaSchema = z.object({
  title: safeString(200, 3),
  description: optionalSafeString(2000),
  media_type: mediaTypeSchema,
  external_url: optionalHttpsUrlSchema,
  taken_at: z.string().datetime({ offset: true }).optional(),
  tags: mediaTagsSchema,
  visibility: mediaVisibilitySchema.default("all"),
});
export type CreateMediaForm = z.infer<typeof createMediaSchema>;

export const updateMediaSchema = z.object({
  title: safeString(200, 3).optional(),
  description: optionalSafeString(2000),
  taken_at: z.string().datetime({ offset: true }).optional().nullable(),
  tags: mediaTagsSchema.optional(),
  visibility: mediaVisibilitySchema.optional(),
});
export type UpdateMediaForm = z.infer<typeof updateMediaSchema>;

// --- Media upload schemas (signed-URL upload flow) ---

export const mediaFeatureEnum = z.enum(["feed_post", "discussion_thread", "job_posting"]);
export type MediaUploadFeature = z.infer<typeof mediaFeatureEnum>;

export const uploadIntentSchema = z.object({
  orgId: baseSchemas.uuid,
  feature: mediaFeatureEnum,
  fileName: safeString(255),
  mimeType: safeString(127),
  fileSize: z.number().int().positive().max(25 * 1024 * 1024),
});

export type UploadIntentInput = z.infer<typeof uploadIntentSchema>;

export const finalizeUploadSchema = z.object({
  orgId: baseSchemas.uuid,
  mediaId: baseSchemas.uuid,
  entityType: mediaFeatureEnum.optional(),
  entityId: baseSchemas.uuid.optional(),
}).refine(
  (data) => {
    // Both entity fields must be present or both absent
    const hasType = data.entityType !== undefined;
    const hasId = data.entityId !== undefined;
    return hasType === hasId;
  },
  { message: "entityType and entityId must both be provided or both omitted" },
);

export type FinalizeUploadInput = z.infer<typeof finalizeUploadSchema>;

/** Optional mediaIds array for feature POST routes */
export const mediaIdsSchema = z
  .array(baseSchemas.uuid)
  .max(10)
  .default([]);

// v1.5 album schemas
export const createAlbumSchema = z.object({
  name: safeString(200, 2),
  description: optionalSafeString(2000),
});
export type CreateAlbumForm = z.infer<typeof createAlbumSchema>;

// --- Gallery (media_items) schemas with moderation ---

// Status includes "uploading" for the upload-intent flow before finalization
export const mediaItemStatusSchema = z.enum(["uploading", "pending", "approved", "rejected"]);
export type MediaItemStatus = z.infer<typeof mediaItemStatusSchema>;

const GALLERY_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const GALLERY_VIDEO_MAX_BYTES = 100 * 1024 * 1024; // 100MB

export const GALLERY_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

export const galleryMimeTypeSchema = z.string().refine(
  (val) => GALLERY_ALLOWED_MIME_TYPES.has(val),
  { message: "Unsupported file type" },
);

/** Tags transform: lowercase + deduplicate */
const galleryTagsSchema = z
  .array(mediaTagSchema)
  .max(20)
  .default([])
  .transform((tags) => [...new Set(tags.map((t) => t.toLowerCase()))]);

export const galleryUploadIntentSchema = z.object({
  orgId: baseSchemas.uuid,
  fileName: safeString(255),
  mimeType: galleryMimeTypeSchema,
  fileSizeBytes: z.number().int().positive().max(GALLERY_VIDEO_MAX_BYTES),
  title: optionalSafeString(200),
  description: optionalSafeString(2000),
  tags: galleryTagsSchema,
  takenAt: z.string().datetime({ offset: true }).optional(),
}).refine(
  (data) => {
    const isImage = data.mimeType.startsWith("image/");
    if (isImage && data.fileSizeBytes > GALLERY_IMAGE_MAX_BYTES) {
      return false;
    }
    return true;
  },
  { message: "Images must be under 10MB", path: ["fileSizeBytes"] },
);
export type GalleryUploadIntentInput = z.infer<typeof galleryUploadIntentSchema>;

export const galleryUpdateMediaSchema = z.object({
  title: optionalSafeString(200),
  description: optionalSafeString(2000),
  tags: galleryTagsSchema.optional(),
  takenAt: z.string().datetime({ offset: true }).optional().nullable(),
});
export type GalleryUpdateMediaInput = z.infer<typeof galleryUpdateMediaSchema>;

export const moderateMediaSchema = z.object({
  action: z.enum(["approve", "reject"]),
  rejectionReason: optionalSafeString(1000),
}).refine(
  (data) => {
    if (data.action === "reject" && !data.rejectionReason) {
      return false;
    }
    return true;
  },
  { message: "Rejection reason is required when rejecting", path: ["rejectionReason"] },
);
export type ModerateMediaInput = z.infer<typeof moderateMediaSchema>;

export const mediaListQuerySchema = z.object({
  orgId: baseSchemas.uuid,
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  tag: z.string().trim().max(50).optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  mediaType: mediaTypeSchema.optional(),
  status: mediaItemStatusSchema.optional(),
  uploadedBy: z.union([baseSchemas.uuid, z.literal("self")]).optional(),
});
export type MediaListQueryInput = z.infer<typeof mediaListQuerySchema>;
