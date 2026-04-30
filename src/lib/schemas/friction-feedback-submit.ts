import { z } from "zod";
import { safeString } from "./common";

/** POST /api/feedback/submit — JSON body (Friction FeedbackButton) */
export const frictionFeedbackSubmitSchema = z
  .object({
    message: safeString(2000, 1),
    // Private storage object path returned by /api/feedback/screenshot.
    // Kept as screenshot_url for API compatibility with the existing client.
    screenshot_url: z
      .string()
      .regex(
        /^(anonymous|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/i,
        { message: "Screenshot reference is invalid" },
      )
      .max(256, "Screenshot reference is too long")
      .optional(),
    page_url: safeString(2048, 1),
    user_agent: safeString(512, 1),
    context: safeString(500, 1),
    trigger: safeString(100, 1),
  })
  .strict();

export type FrictionFeedbackSubmit = z.infer<typeof frictionFeedbackSubmitSchema>;
