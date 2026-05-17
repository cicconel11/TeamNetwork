import { z } from "zod";
import { baseSchemas } from "@/lib/security/validation";

export const reportTargetTypeSchema = z.enum([
  "chat_message",
  "feed_post",
  "feed_comment",
  "user_profile",
]);
export type ReportTargetType = z.infer<typeof reportTargetTypeSchema>;

export const reportReasonSchema = z.enum([
  "spam",
  "harassment",
  "hate",
  "sexual",
  "violence",
  "self_harm",
  "illegal",
  "impersonation",
  "other",
]);
export type ReportReason = z.infer<typeof reportReasonSchema>;

export const reportContentSchema = z.object({
  organization_id: baseSchemas.uuid,
  target_type: reportTargetTypeSchema,
  target_id: baseSchemas.uuid,
  reported_user_id: baseSchemas.uuid.nullable().optional(),
  reason: reportReasonSchema,
  details: z.string().trim().max(1000).optional().nullable(),
});
export type ReportContentInput = z.infer<typeof reportContentSchema>;

export const toggleBlockSchema = z.object({
  blocked_user_id: baseSchemas.uuid,
});
export type ToggleBlockInput = z.infer<typeof toggleBlockSchema>;
