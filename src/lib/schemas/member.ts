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

// Parent/guardian form
export const newParentSchema = z.object({
  first_name: safeString(100),
  last_name: safeString(100),
  email: optionalEmail,
  phone_number: optionalSafeString(50),
  photo_url: optionalHttpsUrlSchema,
  linkedin_url: optionalHttpsUrlSchema,
  student_name: optionalSafeString(200),
  relationship: optionalSafeString(100),
  notes: optionalSafeString(1000),
});
export type NewParentForm = z.infer<typeof newParentSchema>;

export const editParentSchema = newParentSchema;
export type EditParentForm = z.infer<typeof editParentSchema>;
