import { z } from "zod";
import { safeString } from "./common";

export const aiFeedbackRatingSchema = z.enum(["positive", "negative"]);
export type AIFeedbackRating = z.infer<typeof aiFeedbackRatingSchema>;

export const aiFeedbackSchema = z.object({
  messageId: z.string().uuid(),
  rating: aiFeedbackRatingSchema,
  comment: safeString(1000).optional(),
});

export type AIFeedback = z.infer<typeof aiFeedbackSchema>;
