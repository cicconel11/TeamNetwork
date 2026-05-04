import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Resolves the trusted user id for a telemetry submission.
 *
 * The /api/telemetry/error endpoint is intentionally public, but it must not
 * trust client-supplied `user_id` (forgery would let an anonymous attacker
 * attribute errors to arbitrary users and split the per-user rate-limit
 * bucket across made-up identities).
 *
 * This helper returns ONLY the id from the authenticated Supabase session,
 * or null when no session is present. Body input is ignored on purpose.
 */
export async function resolveTrustedUserId(
  client: SupabaseClient<Database>,
): Promise<string | null> {
  try {
    const { data } = await client.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    // Treat any auth lookup failure as anonymous; never escalate to a
    // body-supplied id.
    return null;
  }
}
