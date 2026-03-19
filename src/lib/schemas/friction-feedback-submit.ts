import { z } from "zod";
import { safeString } from "./common";

/** POST /api/feedback/submit — JSON body (Friction FeedbackButton) */
export const frictionFeedbackSubmitSchema = z
  .object({
    message: safeString(2000, 1),
    screenshot_url: z
      .string()
      .url({ message: "Screenshot URL must be a valid URL" })
      .max(2048, "Screenshot URL is too long")
      .optional(),
    page_url: safeString(2048, 1),
    user_agent: safeString(512, 1),
    context: safeString(500, 1),
    trigger: safeString(100, 1),
  })
  .strict();

export type FrictionFeedbackSubmit = z.infer<typeof frictionFeedbackSubmitSchema>;
