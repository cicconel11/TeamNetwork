import { z } from "zod";

// Re-export base schemas from validation.ts
export { baseSchemas, safeString, uuidArray } from "@/lib/security/validation";

// Create form-friendly versions without transforms
// (transforms cause type mismatches with react-hook-form)
export const optionalSafeString = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .optional();

export const optionalEmail = z
  .string()
  .trim()
  .email("Must be a valid email")
  .max(320)
  .optional()
  .or(z.literal(""));

// Audience schemas for targeting content
export const audienceSchema = z.enum(["members", "alumni", "both", "specific"]);
export type Audience = z.infer<typeof audienceSchema>;

export const announcementAudienceSchema = z.enum(["all", "members", "active_members", "alumni", "individuals"]);
export type AnnouncementAudience = z.infer<typeof announcementAudienceSchema>;

// Notification channel
export const channelSchema = z.enum(["email", "sms", "both"]);
export type Channel = z.infer<typeof channelSchema>;

// URL validation
export const httpsUrlSchema = z
  .string()
  .trim()
  .refine(
    (val) => {
      if (!val) return true; // Allow empty
      try {
        const url = new URL(val);
        return url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Must be a valid https:// URL" }
  );

export const optionalHttpsUrlSchema = z
  .string()
  .trim()
  .refine(
    (val) => {
      if (!val) return true; // Allow empty
      try {
        const url = new URL(val);
        return url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Must be a valid https:// URL" }
  )
  .optional();

// Date and time validation
export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Must be a valid date (YYYY-MM-DD)" });

export const optionalDateStringSchema = z
  .string()
  .refine(
    (val) => val === "" || /^\d{4}-\d{2}-\d{2}$/.test(val),
    { message: "Must be a valid date (YYYY-MM-DD)" }
  )
  .optional();

export const timeStringSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, { message: "Must be a valid time (HH:MM)" });

export const optionalTimeStringSchema = z
  .string()
  .refine(
    (val) => val === "" || /^\d{2}:\d{2}$/.test(val),
    { message: "Must be a valid time (HH:MM)" }
  )
  .optional();

// Graduation year validation (1900-2100) - keep as string for form handling
export const graduationYearSchema = z
  .string()
  .refine(
    (val) => {
      if (!val) return true; // Allow empty
      const num = parseInt(val, 10);
      return !isNaN(num) && num >= 1900 && num <= 2100;
    },
    { message: "Graduation year must be between 1900 and 2100" }
  )
  .optional();

// Target user IDs (array of UUIDs for specific audience)
export const targetUserIdsSchema = z
  .array(z.string().uuid())
  .max(200, { message: "Maximum 200 recipients allowed" })
  .default([]);

// Hex color validation
export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, { message: "Color must be a 6 character hex code (e.g., #1e3a5f)" });

// Member status
export const memberStatusSchema = z.enum(["active", "inactive", "pending"]);
export type MemberStatus = z.infer<typeof memberStatusSchema>;

// Event types
export const eventTypeSchema = z.enum(["general", "philanthropy", "game", "meeting", "social", "fundraiser"]);
export type EventType = z.infer<typeof eventTypeSchema>;

// Occurrence types for schedules
export const occurrenceTypeSchema = z.enum(["single", "daily", "weekly", "monthly"]);
export type OccurrenceType = z.infer<typeof occurrenceTypeSchema>;

// Day of week (0-6, Sunday = 0)
export const dayOfWeekSchema = z
  .array(z.string().regex(/^[0-6]$/))
  .min(1, { message: "Select at least one day" });

// Day of month (1-31)
export const dayOfMonthSchema = z
  .string()
  .regex(/^([1-9]|[12]\d|3[01])$/, { message: "Must be a valid day of month (1-31)" });

// URL validation for API routes (allows http/https/webcal)
export const safeUrl = (maxLength = 2048) =>
  z
    .string()
    .trim()
    .min(1, "URL is required")
    .max(maxLength, `URL must be ${maxLength} characters or fewer`)
    .refine(
      (val) => {
        try {
          const url = new URL(val.startsWith("webcal://") ? `https://${val.slice(9)}` : val);
          return url.protocol === "http:" || url.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "Must be a valid URL (http, https, or webcal)" }
    );
