import { z } from "zod";
import { baseSchemas, optionalSafeString } from "@/lib/security/validation";

export const enterprisePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: optionalSafeString(800).nullable(),
    logo_url: z.string().url().max(500).optional().nullable(),
    primary_color: baseSchemas.hexColor.optional().nullable(),
    billing_contact_email: baseSchemas.email.optional().nullable(),
  })
  .strict();
