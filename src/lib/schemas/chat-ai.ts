import { z } from "zod";
import { safeString } from "./common";

export const assistantChatMessageDraftSchema = z.object({
  recipient_member_id: z.string().uuid().optional(),
  person_query: safeString(200, 1).optional(),
  body: safeString(4000, 1).optional(),
});

export type AssistantChatMessageDraft = z.infer<typeof assistantChatMessageDraftSchema>;

export const assistantPreparedChatMessageSchema = z.object({
  recipient_member_id: z.string().uuid(),
  recipient_user_id: z.string().uuid(),
  recipient_display_name: safeString(200, 1),
  body: safeString(4000, 1),
  existing_chat_group_id: z.string().uuid().optional(),
});

export type AssistantPreparedChatMessage = z.infer<typeof assistantPreparedChatMessageSchema>;
