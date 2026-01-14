import { NextResponse } from "next/server";
import { z } from "zod";

export class ValidationError extends Error {
  details?: string[];

  constructor(message: string, details?: string[]) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

const DEFAULT_MAX_BODY_BYTES = 25_000;

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
};

export const safeString = (max: number, min = 1) =>
  z.string().trim().min(min, "Value is required").max(max, `Must be ${max} characters or fewer`);

export const optionalSafeString = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

export const optionalEmail = baseSchemas.email.optional().transform((value) => (value === "" ? undefined : value));

export const uuidArray = (max = 200) =>
  z
    .array(baseSchemas.uuid)
    .max(max, { message: `Provide ${max} recipients or fewer` })
    .transform((values) => Array.from(new Set(values)));

export async function validateJson<T>(
  request: Request,
  schema: z.ZodSchema<T>,
  options?: { maxBodyBytes?: number },
): Promise<T> {
  const maxBytes = options?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new ValidationError("Request body too large");
  }

  let data: unknown;
  try {
    data = await request.json();
  } catch {
    throw new ValidationError("Invalid JSON payload");
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
    throw new ValidationError("Invalid request body", details);
  }

  return parsed.data;
}

export function validationErrorResponse(error: ValidationError) {
  return NextResponse.json(
    {
      error: error.message,
      details: error.details,
    },
    { status: 400 },
  );
}
