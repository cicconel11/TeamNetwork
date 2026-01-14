import { z } from "zod";
import { safeString } from "@/lib/security/validation";
import { optionalSafeString, optionalEmail, optionalHttpsUrlSchema } from "./common";

export const createMentorProfileSchema = z.object({
  bio: optionalSafeString(2000),
  expertise_areas: z
    .string()
    .trim()
    .max(1000, "Expertise areas must be 1000 characters or fewer")
    .optional(),
  contact_email: optionalEmail,
  contact_linkedin: optionalHttpsUrlSchema,
  contact_phone: z
    .string()
    .trim()
    .max(20, "Phone number must be 20 characters or fewer")
    .optional()
    .or(z.literal("")),
});

export type CreateMentorProfileForm = z.infer<typeof createMentorProfileSchema>;
