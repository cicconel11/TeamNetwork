import type { ServiceSupabase } from "@/lib/supabase/types";

/**
 * Server-side mobile-handoff failure taxonomy. These classify *which* server
 * failure occurred so logs are triage-able by category and environment,
 * WITHOUT ever recording the one-time code, its hash, encrypted payloads, or
 * decrypted tokens. See `logMobileHandoffFailure`.
 *
 * - `rpc_error`         — the `consume_mobile_auth_handoff` RPC returned an error.
 * - `decrypt_error`     — a consumed row could not be decrypted into tokens.
 * - `handoff_insert_error` — minting a handoff row on the OAuth callback failed.
 *
 * Note: the not-found / expired case (RPC returns no row) is expected traffic
 * — a 400, not a server failure — and is deliberately NOT part of this taxonomy
 * and NOT logged as an error.
 */
export type MobileHandoffFailureCategory =
  | "rpc_error"
  | "decrypt_error"
  | "handoff_insert_error";

/** Safe, non-secret context attached to every mobile-handoff failure log. */
export type MobileHandoffLogContext = {
  /** Failure classification for triage. */
  category: MobileHandoffFailureCategory;
  /** Deployment environment (`production` / `preview` / `development`). */
  env: string;
  /** Best-effort caller IP (from proxy headers). Never a secret. */
  ip?: string | null;
  /**
   * Supabase-reported error message. Present for RPC / insert failures — the
   * DB message describes the failure class (constraint, connection) and never
   * echoes the code, its hash, or token ciphertext, none of which are passed to
   * the RPC in a form the message would contain.
   */
  reason?: string;
};

/**
 * The current deployment environment, preferring Vercel's env when present.
 * Safe to log — it is a fixed enum, never user data.
 */
export function resolveHandoffEnv(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
}

/**
 * Structured, no-PII failure log for the mobile sign-in handoff.
 *
 * SECURITY: callers MUST NOT place the one-time code, `p_code_hash`,
 * `encrypted_*` values, or decrypted tokens into `context`. This function only
 * ever emits the fields of `MobileHandoffLogContext`, all of which are safe.
 */
export function logMobileHandoffFailure(
  message: string,
  context: MobileHandoffLogContext
): void {
  // Node server structured logging — the established web pattern (there is no
  // dedicated logger module or Sentry on web). Object form keeps fields greppable.
  console.error(`[mobile-handoff] ${message}`, context);
}

type ConsumeMobileAuthHandoffRow = {
  encrypted_access_token: string;
  encrypted_refresh_token: string;
};

/**
 * Result of exchanging a one-time handoff code for session tokens.
 * `ok` carries the decrypted tokens; every other variant maps to an HTTP status
 * at the route boundary. `not_found` is expected traffic (expired/used/unknown
 * code) and is intentionally distinct from the alert-worthy failures.
 */
export type ConsumeMobileHandoffResult =
  | { status: "ok"; accessToken: string; refreshToken: string }
  | { status: "rpc_error" }
  | { status: "not_found" }
  | { status: "decrypt_error" };

/** Dependencies for `consumeMobileHandoff`, injected so the core is testable. */
export type ConsumeMobileHandoffDeps = {
  /** Privileged client used to run the consume RPC. */
  serviceClient: ServiceSupabase;
  /** SHA-256 hex of the one-time code (never logged). */
  codeHash: string;
  /** Decrypts a stored ciphertext token; throws on tampered/invalid input. */
  decrypt: (encryptedToken: string) => string;
  /** Safe context for any failure log emitted by this function. */
  logContext: { env: string; ip?: string | null };
};

/**
 * Consume a mobile OAuth handoff code: run the single-use RPC, then decrypt the
 * returned tokens. Alert-worthy failures (`rpc_error`, `decrypt_error`) are
 * logged here with a category and safe context; the expected `not_found` case
 * is returned silently. NEVER logs the code, its hash, ciphertext, or tokens.
 */
export async function consumeMobileHandoff(
  deps: ConsumeMobileHandoffDeps
): Promise<ConsumeMobileHandoffResult> {
  const { serviceClient, codeHash, decrypt, logContext } = deps;

  // Cast: consume_mobile_auth_handoff RPC is in the database but not yet in the
  // generated Database types. Regenerate via `bun run gen:types` to drop.
  const { data, error } = await (
    serviceClient as unknown as {
      rpc: (
        fn: string,
        args: { p_code_hash: string }
      ) => Promise<{
        data: ConsumeMobileAuthHandoffRow[] | null;
        error: { message: string } | null;
      }>;
    }
  ).rpc("consume_mobile_auth_handoff", { p_code_hash: codeHash });

  if (error) {
    logMobileHandoffFailure("Consume RPC failed", {
      category: "rpc_error",
      env: logContext.env,
      ip: logContext.ip,
      reason: error.message,
    });
    return { status: "rpc_error" };
  }

  const row = Array.isArray(data)
    ? (data[0] as ConsumeMobileAuthHandoffRow | undefined)
    : null;
  if (!row) {
    // Expected traffic: expired, already-consumed, or unknown code. Not an error.
    return { status: "not_found" };
  }

  try {
    return {
      status: "ok",
      accessToken: decrypt(row.encrypted_access_token),
      refreshToken: decrypt(row.encrypted_refresh_token),
    };
  } catch {
    // Deliberately drop the caught error object: decrypt failures can carry
    // fragments of ciphertext in their message. The category + env are enough
    // to triage (key rotation / corrupted row) without leaking material.
    logMobileHandoffFailure("Failed to decrypt consumed handoff", {
      category: "decrypt_error",
      env: logContext.env,
      ip: logContext.ip,
    });
    return { status: "decrypt_error" };
  }
}
