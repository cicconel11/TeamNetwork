import { z } from "zod";
import { baseSchemas, optionalSafeString, safeString, allowedImageUrl } from "@/lib/security/validation";

export const enterprisePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: optionalSafeString(800).nullable(),
    logo_url: allowedImageUrl.optional().nullable(),
    primary_color: baseSchemas.hexColor.optional().nullable(),
    billing_contact_email: baseSchemas.email.optional().nullable(),
  })
  .strict();

export const batchCreateOrgsSchema = z
  .object({
    organizations: z
      .array(
        z
          .object({
            name: safeString(120),
            slug: baseSchemas.slug,
            description: optionalSafeString(800).optional(),
            purpose: optionalSafeString(500).optional(),
            primary_color: baseSchemas.hexColor.optional(),
          })
          .strict()
      )
      .min(1, "At least one organization is required")
      .max(20, "Maximum 20 organizations per batch"),
    memberAssignments: z
      .array(
        z
          .object({
            orgIndex: z.number().int().min(0),
            existingMembers: z
              .array(
                z
                  .object({
                    userId: z.string().uuid(),
                    sourceOrgId: z.string().uuid(),
                    action: z.enum(["move", "copy"]),
                  })
                  .strict()
              )
              .max(200)
              .optional(),
            emailInvites: z
              .array(
                z
                  .object({
                    email: z.string().email().max(320),
                    role: z
                      .enum(["admin", "active_member", "alumni"])
                      .default("active_member"),
                  })
                  .strict()
              )
              .max(100)
              .optional(),
          })
          .strict()
      )
      .optional(),
  })
  .strict();
