import { z } from "zod";
import {
  safeString,
  optionalSafeString,
  optionalEmail,
  memberStatusSchema,
  graduationYearSchema,
  optionalHttpsUrlSchema,
  optionalDateStringSchema,
} from "./common";

// New member form
export const newMemberSchema = z.object({
  first_name: safeString(100),
  last_name: safeString(100),
  email: optionalEmail,
  role: optionalSafeString(100),
  status: memberStatusSchema,
  graduation_year: graduationYearSchema,
  expected_graduation_date: optionalDateStringSchema,
  photo_url: optionalHttpsUrlSchema,
  linkedin_url: optionalHttpsUrlSchema,
});
export type NewMemberForm = z.infer<typeof newMemberSchema>;

// Edit member form (same fields)
export const editMemberSchema = newMemberSchema;
export type EditMemberForm = z.infer<typeof editMemberSchema>;

// Alumni form (extended fields for alumni directory)
export const newAlumniSchema = z.object({
  first_name: safeString(100),
  last_name: safeString(100),
  email: optionalEmail,
  graduation_year: graduationYearSchema,
  major: optionalSafeString(200),
  job_title: optionalSafeString(200),
  photo_url: optionalHttpsUrlSchema,
  notes: optionalSafeString(1000),
  linkedin_url: optionalHttpsUrlSchema,
  phone_number: optionalSafeString(50),
  industry: optionalSafeString(200),
  current_company: optionalSafeString(200),
  current_city: optionalSafeString(200),
  position_title: optionalSafeString(200),
});
export type NewAlumniForm = z.infer<typeof newAlumniSchema>;

export const editAlumniSchema = newAlumniSchema;
export type EditAlumniForm = z.infer<typeof editAlumniSchema>;

// Valid relationship types for parents/guardians.
// Matches the Select options in NewParentForm and EditParentForm.
export const PARENT_RELATIONSHIPS = [
  "Mother",
  "Father",
  "Guardian",
  "Stepmother",
  "Stepfather",
  "Grandparent",
  "Other",
] as const;
export type ParentRelationship = (typeof PARENT_RELATIONSHIPS)[number];

// Parent/guardian form
export const newParentSchema = z.object({
  first_name: safeString(100),
  last_name: safeString(100),
  email: optionalEmail,
  phone_number: optionalSafeString(50),
  photo_url: optionalHttpsUrlSchema,
  linkedin_url: optionalHttpsUrlSchema,
  student_name: optionalSafeString(200),
  // Accepts null (API sends null for empty fields) or "" (react-hook-form Select value).
  // Runtime refine enforces that non-empty values must match a PARENT_RELATIONSHIPS option.
  // Using string|null|undefined avoids react-hook-form generic inference issues with literal unions.
  relationship: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .optional()
    .refine(
      (v) => !v || (PARENT_RELATIONSHIPS as readonly string[]).includes(v),
      { message: "Please select a valid relationship type" }
    ),
  notes: optionalSafeString(1000),
});
export type NewParentForm = z.infer<typeof newParentSchema>;

export const editParentSchema = newParentSchema;
export type EditParentForm = z.infer<typeof editParentSchema>;
