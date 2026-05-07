import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

declare const __serverBrand: unique symbol;
declare const __serviceBrand: unique symbol;

/**
 * User-bound Supabase client (cookies / auth-scoped via SSR). Operations run
 * under the requesting user's RLS. Branded so the type system rejects
 * accidental swaps with the privileged service-role client.
 */
export type ServerSupabase = SupabaseClient & {
  readonly [__serverBrand]: true;
};

/**
 * Service-role Supabase client. Bypasses RLS — must only be used in trusted
 * server paths. Branded distinct from `ServerSupabase` so callers can't
 * silently pass one where the other is expected.
 */
export type ServiceSupabase = SupabaseClient<Database> & {
  readonly [__serviceBrand]: true;
};
