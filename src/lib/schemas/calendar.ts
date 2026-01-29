import { z } from "zod";
import { safeUrl } from "./common";

// Calendar feed creation schema
export const calendarFeedCreateSchema = z
  .object({
    feedUrl: safeUrl(2048),
    provider: z
      .string()
      .trim()
      .max(50)
      .optional()
      .default("ics"),
    organizationId: z.string().uuid({ message: "Invalid organization ID" }),
  })
  .strict();
export type CalendarFeedCreateRequest = z.infer<typeof calendarFeedCreateSchema>;

// Calendar preferences update schema
export const calendarPreferencesUpdateSchema = z
  .object({
    organizationId: z.string().uuid({ message: "Invalid organization ID" }),
    preferences: z
      .object({
        sync_general: z.boolean().optional(),
        sync_game: z.boolean().optional(),
        sync_meeting: z.boolean().optional(),
        sync_social: z.boolean().optional(),
        sync_fundraiser: z.boolean().optional(),
        sync_philanthropy: z.boolean().optional(),
      })
      .strict()
      .refine(
        (prefs) => Object.values(prefs).some((v) => v !== undefined),
        { message: "At least one preference must be provided" }
      ),
  })
  .strict();
export type CalendarPreferencesUpdateRequest = z.infer<typeof calendarPreferencesUpdateSchema>;
