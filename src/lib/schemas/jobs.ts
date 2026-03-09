import { z } from "zod";
import { safeString } from "@/lib/security/validation";
import { optionalSafeString, optionalEmail, optionalHttpsUrlSchema } from "./common";
import { mediaIdsSchema } from "./media";

export const createJobSchema = z.object({
  title: safeString(200, 3),
  company: safeString(200, 2),
  location: optionalSafeString(200),
  location_type: z.enum(["remote", "hybrid", "onsite"]).optional(),
  description: safeString(10000, 10),
  application_url: optionalHttpsUrlSchema,
  contact_email: optionalEmail,
  industry: optionalSafeString(200),
  experience_level: z.enum(["entry", "mid", "senior", "lead", "executive"]).optional(),
  expires_at: z.string().datetime().optional().nullable(),
  mediaIds: mediaIdsSchema.optional(),
});

export type CreateJobForm = z.infer<typeof createJobSchema>;

export const updateJobSchema = createJobSchema.partial().extend({
  is_active: z.boolean().optional(),
});
export type UpdateJobForm = z.infer<typeof updateJobSchema>;
