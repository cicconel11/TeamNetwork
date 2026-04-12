import { z } from "zod";
import { baseSchemas, optionalSafeString, allowedImageUrl } from "@/lib/security/validation";

export const enterprisePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: optionalSafeString(800).nullable(),
    logo_url: allowedImageUrl.optional().nullable(),
    primary_color: baseSchemas.hexColor.optional().nullable(),
    billing_contact_email: baseSchemas.email.optional().nullable(),
  })
  .strict();
