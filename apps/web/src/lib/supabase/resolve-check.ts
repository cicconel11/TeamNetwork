/**
 * Helper for fail-closed Supabase query error handling.
 *
 * A Supabase query that errors returns `{ data: null, error: {...} }`, which is
 * indistinguishable from "no row found" if the caller only destructures `data`.
 * Use `resolveCheck` at authorization-gating and write-critical call sites to
 * ensure DB errors throw rather than silently returning null.
 *
 * Usage:
 *   const data = resolveCheck(await supabase.from("table").select().maybeSingle(), "context");
 *   // data is T | null — null means "no row", not "query failed"
 */

export type CheckResult<T> = { data: T | null; error: Error | null };

/**
 * Logs and throws if `result.error` is set; otherwise returns `result.data`.
 *
 * @param result  The raw `{ data, error }` object returned by a Supabase query.
 * @param context A short identifier used in log messages (e.g. "getOrgRole").
 * @returns       `data` when the query succeeded (may be null if no row was found).
 * @throws        When `result.error` is truthy — callers never see a swallowed error.
 */
export function resolveCheck<T>(
  result: { data: T | null; error: unknown },
  context: string
): T | null {
  if (result.error) {
    const message =
      result.error instanceof Error
        ? result.error.message
        : typeof result.error === "object" && result.error !== null && "message" in result.error
          ? String((result.error as { message: unknown }).message)
          : String(result.error);
    const err = new Error(`[${context}] DB query failed: ${message}`);
    console.error(err.message);
    throw err;
  }
  return result.data;
}
