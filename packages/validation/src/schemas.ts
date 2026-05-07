import { z } from "zod";

/**
 * Base validation schemas for common types.
 * These are platform-agnostic and can be used in web and mobile.
 */
export const baseSchemas = {
  uuid: z.string().uuid({ message: "Must be a valid UUID" }),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{3,64}$/, { message: "Use 3-64 lowercase letters, numbers, or hyphens" }),
  idempotencyKey: z
    .string()
    .trim()
    .min(8, "Idempotency key must be at least 8 characters")
    .max(120, "Idempotency key is too long"),
  currency: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{3}$/, { message: "Currency must be a 3-letter code" }),
  email: z.string().trim().email().max(320),
  hexColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, { message: "Color must be a 6 character hex code" }),
} as const;

/**
 * Creates a required string schema with min/max length.
 */
export const safeString = (max: number, min = 1) =>
  z.string().trim().min(min, "Value is required").max(max, `Must be ${max} characters or fewer`);

/**
 * Creates an optional string schema that transforms empty strings to undefined.
 */
export const optionalSafeString = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

/**
 * Optional email that transforms empty strings to undefined.
 */
export const optionalEmail = baseSchemas.email
  .optional()
  .transform((value) => (value === "" ? undefined : value));

/**
 * Array of UUIDs with deduplication.
 */
export const uuidArray = (max = 200) =>
  z
    .array(baseSchemas.uuid)
    .max(max, { message: `Provide ${max} recipients or fewer` })
    .transform((values) => Array.from(new Set(values)));

/**
 * Organization name validation schema.
 */
export const orgNameSchema = z.string().trim().min(1, "Organization name cannot be empty").max(100, "Organization name must be under 100 characters");

/**
 * Validates an organization name.
 * Returns { valid: true } or { valid: false, error: string }
 */
export function validateOrgName(name: string): { valid: boolean; error?: string } {
  const result = orgNameSchema.safeParse(name);
  if (!result.success) {
    return { valid: false, error: result.error.issues[0]?.message };
  }
  return { valid: true };
}
