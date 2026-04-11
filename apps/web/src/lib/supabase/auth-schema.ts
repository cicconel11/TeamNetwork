/**
 * Typed helpers for querying the Supabase `auth` schema.
 *
 * The generated Database types only cover the `public` schema, so
 * `.schema("auth")` calls lose type safety. These helpers centralise
 * the unavoidable type-cast and expose explicit return types
 * so callers never need their own casts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/** Row shape for auth.users with full metadata (single-user lookups). */
export interface AuthUserRow {
  id: string;
  email: string;
  raw_user_meta_data: Record<string, unknown> | null;
}

/** Row shape for auth.users with email only (bulk lookups). */
export interface AuthUserEmailRow {
  id: string;
  email: string;
}

/**
 * Look up a single auth user by email (case-insensitive ILIKE).
 *
 * Caller must pre-sanitise the email pattern (e.g. via `sanitizeIlikeInput`).
 * Returns `{ data: null, error }` on DB failure — callers MUST check `error`
 * and fail closed (500), never treat null data as "not found" without checking.
 */
export async function lookupAuthUserByEmail(
  serviceSupabase: SupabaseClient<Database>,
  sanitizedEmailPattern: string,
): Promise<{ data: AuthUserRow | null; error: { message: string } | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (serviceSupabase as any)
    .schema("auth")
    .from("users")
    .select("id, email, raw_user_meta_data")
    .ilike("email", sanitizedEmailPattern)
    .maybeSingle();
}

/**
 * Look up multiple auth users by exact email match.
 *
 * Returns `{ data: null, error }` on DB failure — callers MUST check `error`.
 */
export async function lookupAuthUsersByEmail(
  serviceSupabase: SupabaseClient<Database>,
  emails: string[],
): Promise<{ data: AuthUserEmailRow[] | null; error: { message: string } | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (serviceSupabase as any)
    .schema("auth")
    .from("users")
    .select("id, email")
    .in("email", emails);
}
