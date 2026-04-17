/* eslint-disable @typescript-eslint/no-unused-vars */
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

/**
 * Mentee intake form (Phase 2). Mirrors the seeded `mentee_intake_v1` form fields.
 * Used for both form submission payload validation and DB read projection.
 */
export const menteeIntakeSchema = z.object({
  goals: z.string().trim().min(1, "Goals are required").max(2000),
  preferred_topics: z.array(z.string().trim().min(1)).default([]),
  preferred_industry: z.array(z.string().trim().min(1)).default([]),
  preferred_role_families: z.array(z.string().trim().min(1)).default([]),
  time_availability: z
    .enum(["1hr/month", "2hr/month", "4hr/month", "flexible"])
    .optional(),
  communication_prefs: z
    .array(z.enum(["video", "phone", "in_person", "async"]))
    .default([]),
  geographic_pref: z.string().trim().max(200).optional().or(z.literal("")),
  mentor_attributes_required: z.array(z.string().trim().min(1)).default([]),
  mentor_attributes_nice_to_have: z.array(z.string().trim().min(1)).default([]),
});

export type MenteeIntakeForm = z.infer<typeof menteeIntakeSchema>;
