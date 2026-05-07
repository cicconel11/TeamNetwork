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
 * Native mentee_preferences row shape (Phase 1 cutover).
 * One-row-per-(org,user). Upsert target for the inline preferences card.
 */
export const menteePreferencesSchema = z.object({
  goals: z.string().trim().max(2000).optional().or(z.literal("")),
  seeking_mentorship: z.boolean().default(false),
  preferred_topics: z.array(z.string().trim().min(1)).default([]),
  preferred_industries: z.array(z.string().trim().min(1)).default([]),
  preferred_role_families: z.array(z.string().trim().min(1)).default([]),
  preferred_sports: z.array(z.string().trim().min(1)).default([]),
  preferred_positions: z.array(z.string().trim().min(1)).default([]),
  required_attributes: z.array(z.string().trim().min(1)).default([]),
  nice_to_have_attributes: z.array(z.string().trim().min(1)).default([]),
  time_availability: z
    .enum(["1hr/month", "2hr/month", "4hr/month", "flexible"])
    .optional()
    .or(z.literal("")),
  communication_prefs: z
    .array(z.enum(["video", "phone", "in_person", "async"]))
    .default([]),
  geographic_pref: z.string().trim().max(200).optional().or(z.literal("")),
});

export type MenteePreferencesForm = z.infer<typeof menteePreferencesSchema>;

/**
 * Mentee intake form (legacy seeded form path).
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

/**
 * Native mentor_profiles edit shape (Phase 3 inline card).
 */
export const mentorProfileNativeSchema = z.object({
  bio: optionalSafeString(2000),
  expertise_areas: z.array(z.string().trim().min(1).max(100)).max(32).default([]),
  topics: z.array(z.string().trim().min(1).max(100)).max(32).default([]),
  sports: z.array(z.string().trim().min(1).max(100)).max(16).default([]),
  positions: z.array(z.string().trim().min(1).max(100)).max(16).default([]),
  industries: z.array(z.string().trim().min(1).max(100)).max(16).default([]),
  role_families: z.array(z.string().trim().min(1).max(100)).max(16).default([]),
  max_mentees: z.number().int().min(0).max(100).default(3),
  accepting_new: z.boolean().default(true),
  meeting_preferences: z
    .array(z.enum(["video", "phone", "in_person", "async"]))
    .default([]),
  time_commitment: z.string().trim().max(100).optional().or(z.literal("")),
  years_of_experience: z.number().int().min(0).max(80).nullable().optional(),
});

export type MentorProfileNativeForm = z.infer<typeof mentorProfileNativeSchema>;

/* ------------------------------------------------------------------ */
/*  Custom attribute definitions (org-level config)                   */
/* ------------------------------------------------------------------ */

export const customAttributeDefSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, "Key must be lowercase alphanumeric with underscores, 1-31 chars"),
  label: z.string().trim().min(1).max(100),
  type: z.enum(["select", "multiselect", "text"]),
  options: z.array(z.object({
    label: z.string().trim().min(1).max(200),
    value: z.string().trim().min(1).max(200),
  })).max(50).optional(),
  weight: z.number().min(0).max(100).default(0),
  required: z.boolean().optional(),
  mentorVisible: z.boolean().optional(),
  menteeVisible: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const customAttributeDefsSchema = z.array(customAttributeDefSchema).max(20);

export type CustomAttributeDefForm = z.infer<typeof customAttributeDefSchema>;
