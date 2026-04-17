import { z } from "zod";

// ─── Item IDs ────────────────────────────────────────────────────────────────

export const ONBOARDING_ITEM_IDS = [
  "complete_profile",
  "post_feed",
  "rsvp_event",
  "send_message",
  "read_announcement",
  "configure_notifications",
  "update_linkedin",
  "browse_alumni_directory",
  "log_workout",
] as const;

export type OnboardingItemId = (typeof ONBOARDING_ITEM_IDS)[number];

export const onboardingItemIdSchema = z.enum(ONBOARDING_ITEM_IDS);

// ─── DB row shape ────────────────────────────────────────────────────────────

export const onboardingProgressRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  completed_items: z.array(onboardingItemIdSchema),
  visited_items: z.array(onboardingItemIdSchema),
  welcome_seen_at: z.string().datetime().nullable(),
  tour_completed_at: z.string().datetime().nullable(),
  dismissed_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type OnboardingProgressRow = z.infer<typeof onboardingProgressRowSchema>;

// ─── Mutation payloads ────────────────────────────────────────────────────────

export const markItemCompleteSchema = z.object({
  orgId: z.string().uuid(),
  itemId: onboardingItemIdSchema,
});

export const markVisitedSchema = z.object({
  orgId: z.string().uuid(),
  itemId: onboardingItemIdSchema,
});

export const dismissChecklistSchema = z.object({
  orgId: z.string().uuid(),
});

export const markWelcomeSeenSchema = z.object({
  orgId: z.string().uuid(),
});

export const markTourCompletedSchema = z.object({
  orgId: z.string().uuid(),
});

// ─── API response ─────────────────────────────────────────────────────────────

export const onboardingStatusResponseSchema = z.object({
  completedItems: z.array(onboardingItemIdSchema),
  visitedItems: z.array(onboardingItemIdSchema),
  welcomeSeenAt: z.string().datetime().nullable(),
  tourCompletedAt: z.string().datetime().nullable(),
  dismissedAt: z.string().datetime().nullable(),
  autoCompleted: z.array(onboardingItemIdSchema),
});

export type OnboardingStatusResponse = z.infer<typeof onboardingStatusResponseSchema>;
