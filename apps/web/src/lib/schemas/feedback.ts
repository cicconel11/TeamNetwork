import { z } from "zod";
import { safeString } from "./common";

// Feedback form
export const feedbackSchema = z.object({
  category: z.enum(["bug", "feature", "improvement", "other"]).default("other"),
  subject: safeString(200),
  description: safeString(5000),
  email: z.string().email().optional().or(z.literal("")),
  // File attachment is handled separately (not in schema validation)
});
export type FeedbackForm = z.infer<typeof feedbackSchema>;
