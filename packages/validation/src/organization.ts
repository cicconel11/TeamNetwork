import { z } from "zod";
import { baseSchemas, safeString } from "./schemas";

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

export const subscriptionIntervalSchema = z.enum(["month", "year"]);
export type SubscriptionInterval = z.infer<typeof subscriptionIntervalSchema>;

const optionalDescriptionSchema = z
  .string()
  .trim()
  .max(1000, "Must be 1000 characters or fewer")
  .optional();

export const createOrgSchema = z.object({
  name: safeString(200),
  slug: baseSchemas.slug,
  description: optionalDescriptionSchema,
  primaryColor: baseSchemas.hexColor,
  billingInterval: subscriptionIntervalSchema,
  alumniBucket: alumniBucketSchema,
  withTrial: z.boolean(),
});
export type CreateOrgForm = z.infer<typeof createOrgSchema>;
