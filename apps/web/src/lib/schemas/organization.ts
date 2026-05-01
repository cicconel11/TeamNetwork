import { z } from "zod";
import { safeString, optionalSafeString, hexColorSchema } from "./common";

// Re-export shared org schemas from @teammeet/validation so web and mobile
// validate identically. Web-only schemas (org settings, locale) stay below.
export {
  alumniBucketSchema,
  subscriptionIntervalSchema,
  createOrgSchema,
} from "@teammeet/validation";
export type {
  AlumniBucket,
  SubscriptionInterval,
  CreateOrgForm,
} from "@teammeet/validation";

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

// Supported locales for i18n
export const supportedLocaleSchema = z.enum(["en", "es", "fr", "ar", "zh", "pt", "it"]);
export type SupportedLocaleValue = z.infer<typeof supportedLocaleSchema>;

// Optional locale (for user override — null means "use org default")
export const optionalLocaleSchema = supportedLocaleSchema.nullable().optional();
