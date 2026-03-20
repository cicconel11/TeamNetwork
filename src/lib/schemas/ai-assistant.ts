import { z } from "zod";
import { safeString } from "./common";

export const sendMessageSchema = z.object({
  threadId: z.string().uuid().optional(),
  message: safeString(4000),
  surface: z.enum(["general", "members", "analytics", "events"]),
  idempotencyKey: z.string().uuid(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const listThreadsSchema = z.object({
  surface: z.enum(["general", "members", "analytics", "events"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
});

export type ListThreadsInput = z.infer<typeof listThreadsSchema>;
