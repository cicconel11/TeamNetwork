/**
 * Normalize values passed to Sentry.captureException.
 * Supabase/PostgREST often reject with plain objects, not Error instances.
 */

export function isPostgrestStyleError(
  value: unknown
): value is { message?: unknown; code?: unknown; details?: unknown; hint?: unknown } {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const o = value as Record<string, unknown>;
  return "message" in o && "code" in o && "details" in o && "hint" in o;
}

export function normalizeCaptureError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  if (isPostgrestStyleError(error)) {
    const msg =
      typeof error.message === "string" && error.message.trim() !== ""
        ? error.message
        : typeof error.code === "string" && error.code.trim() !== ""
          ? `PostgREST error: ${error.code}`
          : "PostgREST/Supabase error";
    const err = new Error(msg);
    err.name = "PostgrestError";
    return err;
  }
  if (error === null || error === undefined) {
    return new Error("Unknown error (null/undefined)");
  }
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

export function buildCaptureExtra(
  error: unknown,
  context?: Record<string, unknown>
): Record<string, unknown> | undefined {
  const base = context && Object.keys(context).length > 0 ? { ...context } : undefined;
  if (isPostgrestStyleError(error)) {
    return {
      ...base,
      supabaseError: {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      },
    };
  }
  return base;
}
