import { z } from "zod";
import { safeString } from "./common";

export const sendMessageSchema = z.object({
  threadId: z.string().uuid().optional(),
  message: safeString(4000),
  surface: z.enum(["general", "members", "analytics", "events"]),
  idempotencyKey: z.string().uuid(),
  bypassCache: z.boolean().optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const listThreadsSchema = z.object({
  surface: z.enum(["general", "members", "analytics", "events"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
});

export type ListThreadsInput = z.infer<typeof listThreadsSchema>;

const CACHE_INELIGIBLE_REASONS = [
  "has_thread_context",
  "contains_temporal_marker",
  "contains_personalization",
  "implies_write_or_tool",
  "bypass_requested",
  "message_too_short",
  "message_too_long",
] as const;

export const cacheEligibilitySchema = z.discriminatedUnion("eligible", [
  z.object({
    eligible: z.literal(true),
    reason: z.literal("cacheable"),
  }),
  z.object({
    eligible: z.literal(false),
    reason: z.enum(CACHE_INELIGIBLE_REASONS),
  }),
]);

export type CacheEligibility = z.infer<typeof cacheEligibilitySchema>;
