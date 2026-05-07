import { z } from "zod";
import { baseSchemas, safeString, optionalSafeString, hexColorSchema } from "./common";
import { subscriptionIntervalSchema } from "./organization";

const v2Count = (max: number) => z.number().int().min(0).max(max);

export const createOrgV2Schema = z
  .object({
    name: safeString(120),
    slug: baseSchemas.slug,
    description: optionalSafeString(800),
    primaryColor: hexColorSchema,
    billingInterval: subscriptionIntervalSchema,
    actives: v2Count(1_000_000),
    alumni: v2Count(1_000_000),
    idempotencyKey: baseSchemas.idempotencyKey.optional(),
    paymentAttemptId: baseSchemas.uuid.optional(),
  })
  .strict();
export type CreateOrgV2Form = z.infer<typeof createOrgV2Schema>;

export const createEnterpriseV2Schema = z
  .object({
    name: safeString(120),
    slug: baseSchemas.slug,
    description: optionalSafeString(800),
    primaryColor: hexColorSchema,
    billingInterval: subscriptionIntervalSchema,
    actives: v2Count(1_000_000),
    alumni: v2Count(1_000_000),
    subOrgs: v2Count(1_000),
    billingContactEmail: baseSchemas.email,
    idempotencyKey: baseSchemas.idempotencyKey.optional(),
    paymentAttemptId: baseSchemas.uuid.optional(),
  })
  .strict();
export type CreateEnterpriseV2Form = z.infer<typeof createEnterpriseV2Schema>;
