import { z } from "zod";
import { safeString } from "./common";

const aiSurfaceEnum = z.enum(["general", "members", "analytics", "events"]);
export type AiSurface = z.infer<typeof aiSurfaceEnum>;

const rawSendMessageSchema = z.object({
  threadId: z.string().uuid().optional(),
  message: safeString(4000),
  surface: aiSurfaceEnum,
  idempotencyKey: z.string().uuid(),
  bypassCache: z.boolean().optional(),
  bypass_cache: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (
    value.bypassCache !== undefined &&
    value.bypass_cache !== undefined &&
    value.bypassCache !== value.bypass_cache
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "bypassCache and bypass_cache must match when both are provided",
      path: ["bypass_cache"],
    });
  }
});

export const sendMessageSchema = rawSendMessageSchema.transform(
  ({ bypass_cache, bypassCache, ...rest }) => ({
    ...rest,
    bypassCache: bypassCache ?? bypass_cache,
  })
);

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const listThreadsSchema = z.object({
  surface: aiSurfaceEnum.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

export type ListThreadsInput = z.infer<typeof listThreadsSchema>;

const CACHE_INELIGIBLE_REASONS = [
  "unsupported_surface",
  "has_thread_context",
  "contains_temporal_marker",
  "contains_personalization",
  "requires_live_org_context",
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
