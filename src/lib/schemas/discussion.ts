import { z } from "zod";
import { safeString } from "@/lib/security/validation";
import { mediaIdsSchema } from "./media";

export const createThreadSchema = z.object({
  title: safeString(200, 5),
  body: safeString(10000, 10),
  mediaIds: mediaIdsSchema.optional(),
});

export type CreateThreadForm = z.infer<typeof createThreadSchema>;

export const assistantDiscussionDraftSchema = z.object({
  title: safeString(200, 5).optional(),
  body: safeString(10000, 10).optional(),
  mediaIds: mediaIdsSchema.optional(),
});

export type AssistantDiscussionDraft = z.infer<typeof assistantDiscussionDraftSchema>;

export const assistantPreparedDiscussionSchema = z.object({
  title: safeString(200, 5),
  body: safeString(10000, 10),
  mediaIds: mediaIdsSchema.optional(),
});

export type AssistantPreparedDiscussion = z.infer<typeof assistantPreparedDiscussionSchema>;

export const createReplySchema = z.object({
  body: safeString(5000, 1),
});

export type CreateReplyForm = z.infer<typeof createReplySchema>;

export const assistantDiscussionReplyDraftSchema = z.object({
  discussion_thread_id: z.string().uuid().optional(),
  thread_title: safeString(200, 1).optional(),
  body: safeString(5000, 1).optional(),
});

export type AssistantDiscussionReplyDraft = z.infer<typeof assistantDiscussionReplyDraftSchema>;

export const assistantPreparedDiscussionReplySchema = z.object({
  discussion_thread_id: z.string().uuid(),
  thread_title: safeString(200, 1).optional(),
  body: safeString(5000, 1),
});

export type AssistantPreparedDiscussionReply = z.infer<typeof assistantPreparedDiscussionReplySchema>;
