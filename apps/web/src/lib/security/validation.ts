import { NextResponse } from "next/server";
import { z } from "zod";

// Re-export shared validation schemas from the validation package
export {
  baseSchemas,
  safeString,
  optionalSafeString,
  optionalEmail,
  uuidArray,
  orgNameSchema,
  validateOrgName,
} from "@teammeet/validation";

/**
 * Validation error class for API routes.
 */
export class ValidationError extends Error {
  details?: string[];

  constructor(message: string, details?: string[]) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

const DEFAULT_MAX_BODY_BYTES = 25_000;

/**
 * Validates JSON request body against a Zod schema.
 * Next.js-specific - uses Request object.
 */
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

/**
 * Creates a NextResponse for validation errors.
 * Next.js-specific.
 */
export function validationErrorResponse(error: ValidationError) {
  return NextResponse.json(
    {
      error: error.message,
      details: error.details,
    },
    { status: 400 },
  );
}
