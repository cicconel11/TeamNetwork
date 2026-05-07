import { z } from "zod";
import { safeString } from "@/lib/security/validation";
import { optionalSafeString, optionalEmail, optionalHttpsUrlSchema } from "./common";
import { mediaIdsSchema } from "./media";

const locationTypeSchema = z.enum(["remote", "hybrid", "onsite"]);
const experienceLevelSchema = z.enum(["entry", "mid", "senior", "lead", "executive"]);

export const createJobSchema = z.object({
  title: safeString(200, 3),
  company: safeString(200, 2),
  location: optionalSafeString(200),
  location_type: locationTypeSchema.optional(),
  description: safeString(10000, 10),
  application_url: optionalHttpsUrlSchema,
  contact_email: optionalEmail,
  industry: optionalSafeString(200),
  experience_level: experienceLevelSchema.optional(),
  expires_at: z.string().datetime().optional().nullable(),
  mediaIds: mediaIdsSchema.optional(),
});

export type CreateJobForm = z.infer<typeof createJobSchema>;

export const updateJobSchema = createJobSchema.partial().extend({
  is_active: z.boolean().optional(),
});
export type UpdateJobForm = z.infer<typeof updateJobSchema>;

export const assistantJobDraftSchema = z.object({
  title: safeString(200, 3).optional(),
  company: safeString(200, 2).optional(),
  location: safeString(200, 2).optional(),
  location_type: locationTypeSchema.optional(),
  description: safeString(10000, 10).optional(),
  application_url: optionalHttpsUrlSchema,
  contact_email: optionalEmail,
  industry: safeString(200, 2).optional(),
  experience_level: experienceLevelSchema.optional(),
  expires_at: z.string().datetime().optional().nullable(),
  mediaIds: mediaIdsSchema.optional(),
});

export type AssistantJobDraft = z.infer<typeof assistantJobDraftSchema>;

export const assistantPreparedJobSchema = z.object({
  title: safeString(200, 3),
  company: safeString(200, 2),
  location: safeString(200, 2),
  location_type: locationTypeSchema.optional(),
  description: safeString(10000, 10),
  application_url: optionalHttpsUrlSchema,
  contact_email: optionalEmail,
  industry: safeString(200, 2),
  experience_level: experienceLevelSchema,
  expires_at: z.string().datetime().optional().nullable(),
  mediaIds: mediaIdsSchema.optional(),
}).superRefine((value, ctx) => {
  const hasApplicationUrl =
    typeof value.application_url === "string" && value.application_url.trim().length > 0;
  const hasContactEmail =
    typeof value.contact_email === "string" && value.contact_email.trim().length > 0;

  if (!hasApplicationUrl && !hasContactEmail) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["application_url"],
      message: "Provide an application URL or contact email",
    });
  }
});

export type AssistantPreparedJob = z.infer<typeof assistantPreparedJobSchema>;
