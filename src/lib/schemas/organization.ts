import { z } from "zod";
import { baseSchemas, safeString, optionalSafeString, hexColorSchema } from "./common";

// Alumni bucket tiers
export const alumniBucketSchema = z.enum([
  "none",
  "0-250",
  "251-500",
  "501-1000",
  "1001-2500",
  "2500-5000",
  "5000+",
]);
export type AlumniBucket = z.infer<typeof alumniBucketSchema>;

// Billing interval
export const subscriptionIntervalSchema = z.enum(["month", "year"]);
export type SubscriptionInterval = z.infer<typeof subscriptionIntervalSchema>;

// Create organization form
export const createOrgSchema = z.object({
  name: safeString(200),
  slug: baseSchemas.slug,
  description: optionalSafeString(1000),
  primaryColor: hexColorSchema,
  billingInterval: subscriptionIntervalSchema,
  alumniBucket: alumniBucketSchema,
});
export type CreateOrgForm = z.infer<typeof createOrgSchema>;

// Organization settings form
export const orgSettingsSchema = z.object({
  name: safeString(200),
  description: optionalSafeString(1000),
  primaryColor: hexColorSchema,
  logo_url: z
    .string()
    .trim()
    .refine(
      (val) => {
        if (!val) return true;
        try {
          const url = new URL(val);
          return url.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "Logo URL must be a valid https:// URL" }
    )
    .transform((val) => (val === "" ? undefined : val))
    .optional(),
});
export type OrgSettingsForm = z.infer<typeof orgSettingsSchema>;
