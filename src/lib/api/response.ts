import { NextResponse } from "next/server";

/**
 * Standard error response codes used across the API
 */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "ORG_READ_ONLY"
  | "INTERNAL_ERROR"
  | "DATABASE_ERROR"
  | "PAYMENT_ERROR";

/**
 * Standard API error response format
 */
export interface ApiError {
  error: string;
  message: string;
  code?: ErrorCode;
  details?: string[];
}

/**
 * Create a standardized error response
 */
export function errorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  details?: string[],
  headers?: Record<string, string>
): NextResponse<ApiError> {
  const body: ApiError = {
    error: humanReadableError(code),
    message,
    code,
  };

  if (details && details.length > 0) {
    body.details = details;
  }

  return NextResponse.json(body, { status, headers });
}

/**
 * Convert error code to human-readable error name
 */
function humanReadableError(code: ErrorCode): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "Unauthorized";
    case "FORBIDDEN":
      return "Forbidden";
    case "NOT_FOUND":
      return "Not found";
    case "BAD_REQUEST":
      return "Bad request";
    case "VALIDATION_ERROR":
      return "Validation error";
    case "RATE_LIMITED":
      return "Too many requests";
    case "ORG_READ_ONLY":
      return "Organization is in read-only mode";
    case "INTERNAL_ERROR":
      return "Internal error";
    case "DATABASE_ERROR":
      return "Database error";
    case "PAYMENT_ERROR":
      return "Payment error";
  }
}

/**
 * 401 Unauthorized response
 */
export function unauthorized(message = "You must be logged in to access this resource."): NextResponse<ApiError> {
  return errorResponse("UNAUTHORIZED", message, 401);
}

/**
 * 403 Forbidden response
 */
export function forbidden(message = "You do not have permission to access this resource."): NextResponse<ApiError> {
  return errorResponse("FORBIDDEN", message, 403);
}

/**
 * 404 Not Found response
 */
export function notFound(message = "The requested resource was not found."): NextResponse<ApiError> {
  return errorResponse("NOT_FOUND", message, 404);
}

/**
 * 400 Bad Request response
 */
export function badRequest(message: string, details?: string[]): NextResponse<ApiError> {
  return errorResponse("BAD_REQUEST", message, 400, details);
}

/**
 * 400 Validation Error response
 */
export function validationError(message: string, details?: string[]): NextResponse<ApiError> {
  return errorResponse("VALIDATION_ERROR", message, 400, details);
}

/**
 * 403 Organization Read-Only response
 */
export function orgReadOnly(message = "Organization is in read-only mode. Please resubscribe to make changes."): NextResponse<ApiError> {
  return errorResponse("ORG_READ_ONLY", message, 403);
}

/**
 * 500 Internal Error response
 */
export function internalError(message = "An unexpected error occurred."): NextResponse<ApiError> {
  return errorResponse("INTERNAL_ERROR", message, 500);
}

/**
 * 500 Database Error response
 */
export function databaseError(message = "A database error occurred."): NextResponse<ApiError> {
  return errorResponse("DATABASE_ERROR", message, 500);
}

/**
 * Create a success response with optional data
 */
export function successResponse<T>(data: T, status = 200, headers?: Record<string, string>): NextResponse<T> {
  return NextResponse.json(data, { status, headers });
}

/**
 * Create a response helper that includes rate limit headers
 */
export function createResponder(headers?: Record<string, string>) {
  return {
    success: <T>(data: T, status = 200) => successResponse(data, status, headers),
    error: (code: ErrorCode, message: string, status: number, details?: string[]) =>
      errorResponse(code, message, status, details, headers),
    unauthorized: (message?: string) =>
      errorResponse("UNAUTHORIZED", message ?? "You must be logged in.", 401, undefined, headers),
    forbidden: (message?: string) =>
      errorResponse("FORBIDDEN", message ?? "Access denied.", 403, undefined, headers),
    notFound: (message?: string) =>
      errorResponse("NOT_FOUND", message ?? "Not found.", 404, undefined, headers),
    badRequest: (message: string, details?: string[]) =>
      errorResponse("BAD_REQUEST", message, 400, details, headers),
    orgReadOnly: () =>
      errorResponse("ORG_READ_ONLY", "Organization is in read-only mode. Please resubscribe to make changes.", 403, undefined, headers),
    internalError: (message?: string) =>
      errorResponse("INTERNAL_ERROR", message ?? "An unexpected error occurred.", 500, undefined, headers),
  };
}
