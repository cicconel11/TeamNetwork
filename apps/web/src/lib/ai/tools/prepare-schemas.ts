import { z } from "zod";

export const prepareAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    body: z.string().trim().optional(),
    is_pinned: z.boolean().optional(),
    audience: z
      .enum(["all", "members", "active_members", "alumni", "individuals"])
      .optional(),
    send_notification: z.boolean().optional(),
    audience_user_ids: z.array(z.string().uuid()).optional(),
  })
  .strict();

export const prepareJobPostingSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    company: z.string().trim().min(1).optional(),
    location: z.string().trim().min(1).optional(),
    location_type: z.enum(["remote", "hybrid", "onsite"]).optional(),
    description: z.string().trim().min(1).optional(),
    application_url: z.string().trim().min(1).optional(),
    contact_email: z.string().trim().min(1).optional(),
    industry: z.string().trim().min(1).optional(),
    experience_level: z
      .enum(["entry", "mid", "senior", "lead", "executive"])
      .optional(),
    expires_at: z.string().datetime().optional().nullable(),
    mediaIds: z.array(z.string().uuid()).optional(),
  })
  .strict();

export const prepareDiscussionThreadSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    body: z.string().trim().min(1).optional(),
    mediaIds: z.array(z.string().uuid()).optional(),
  })
  .strict();

export const prepareDiscussionReplySchema = z
  .object({
    discussion_thread_id: z.string().uuid().optional(),
    thread_title: z.string().trim().min(1).optional(),
    body: z.string().trim().min(1).optional(),
  })
  .strict();

export const prepareChatMessageSchema = z
  .object({
    recipient_member_id: z.string().uuid().optional(),
    person_query: z.string().trim().min(1).optional(),
    body: z.string().trim().min(1).optional(),
  })
  .strict();

export const prepareGroupMessageSchema = z
  .object({
    chat_group_id: z.string().uuid().optional(),
    group_name_query: z.string().trim().min(1).optional(),
    body: z.string().trim().min(1).optional(),
  })
  .strict();

export const prepareEventSchema = z
  .object({
    title: z.string().trim().optional(),
    description: z.string().trim().optional(),
    start_date: z.string().trim().optional(),
    start_time: z.string().trim().optional(),
    end_date: z.string().trim().optional(),
    end_time: z.string().trim().optional(),
    location: z.string().trim().optional(),
    event_type: z
      .enum([
        "general",
        "philanthropy",
        "game",
        "practice",
        "meeting",
        "social",
        "workout",
        "fundraiser",
        "class",
      ])
      .optional(),
    is_philanthropy: z.boolean().optional(),
  })
  .strict();

export const prepareEventsBatchSchema = z
  .object({
    events: z.array(prepareEventSchema).min(1).max(10),
  })
  .strict();

export const prepareUpdateAnnouncementSchema = z
  .object({
    announcement_id: z.string().uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().max(5000).optional(),
    is_pinned: z.boolean().optional(),
    audience: z
      .enum(["all", "members", "active_members", "alumni", "individuals"])
      .optional(),
  })
  .strict();

export const prepareDeleteAnnouncementSchema = z
  .object({
    announcement_id: z.string().uuid(),
  })
  .strict();
