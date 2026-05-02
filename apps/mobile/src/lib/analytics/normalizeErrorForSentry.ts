/**
 * Coerce thrown values into Error instances for Sentry.
 * Supabase / PostgREST often reject with plain objects { code, message, details, hint }
 * rather than Error subclasses; passing those to Sentry groups poorly and shows as
 * "Object captured as exception with keys: ...".
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeSupabaseOrPostgrestError(obj: Record<string, unknown>): boolean {
  return (
    ("message" in obj && typeof obj.message === "string") ||
    ("code" in obj && ("message" in obj || "details" in obj || "hint" in obj))
  );
}

/**
 * Returns an Error suitable for Sentry.captureException and merged extra context.
 */
export function normalizeErrorForSentry(
  thrown: unknown,
  context?: Record<string, unknown>
): { error: Error; extra: Record<string, unknown> } {
  const baseExtra = context ? { ...context } : {};

  if (thrown instanceof Error) {
    return { error: thrown, extra: baseExtra };
  }

  if (thrown === null || thrown === undefined) {
    return {
      error: new Error("Unknown error (null or undefined)"),
      extra: baseExtra,
    };
  }

  if (typeof thrown === "string") {
    return { error: new Error(thrown), extra: baseExtra };
  }

  if (isPlainObject(thrown) && looksLikeSupabaseOrPostgrestError(thrown)) {
    const code = thrown.code != null ? String(thrown.code) : "";
    const message = typeof thrown.message === "string" ? thrown.message : "";
    const details = typeof thrown.details === "string" ? thrown.details : "";
    const hint = typeof thrown.hint === "string" ? thrown.hint : "";

    const parts = [code ? `[${code}]` : "", message || "API error"].filter(Boolean);
    let composed = parts.join(" ").trim() || "API error";
    if (details) {
      composed += ` — ${details}`;
    }
    if (hint) {
      composed += ` (hint: ${hint})`;
    }

    const error = new Error(composed);
    try {
      (error as Error & { cause?: unknown }).cause = thrown;
    } catch {
      // ignore if runtime does not support assignment
    }

    return {
      error,
      extra: {
        ...baseExtra,
        originalThrown: thrown,
      },
    };
  }

  if (isPlainObject(thrown)) {
    const error = new Error("Non-Error thrown (plain object)");
    return {
      error,
      extra: {
        ...baseExtra,
        originalThrown: thrown,
      },
    };
  }

  return {
    error: new Error(String(thrown)),
    extra: baseExtra,
  };
}
