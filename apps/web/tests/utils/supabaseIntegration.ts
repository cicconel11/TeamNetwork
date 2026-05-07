// tests/utils/supabaseIntegration.ts
// Integration test helper — client created lazily to avoid initialising the
// Supabase client when env vars are absent (tests skip via skipWithoutSupabase).

import { createServiceClient } from "@/lib/supabase/service.ts";

// All three env vars are required to connect to the real Supabase project.
const REQUIRED_ENVS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/**
 * Returns true and calls t.skip() if any required env var is missing.
 * Call this at the top of each `it()` callback (TestContext has .skip()).
 * Do NOT call inside `before()` (SuiteContext lacks .skip()).
 */
export function skipWithoutSupabase(t: { skip: (reason: string) => void }): boolean {
  const missing = REQUIRED_ENVS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    t.skip(`Skipping: ${missing.join(", ")} not set`);
    return true;
  }
  return false;
}

/**
 * Returns true if any required env var is missing — for use inside before()
 * hooks where t.skip() is not available.
 */
export function supabaseEnvMissing(): boolean {
  return REQUIRED_ENVS.some((name) => !process.env[name]);
}

export function createIntegrationContext() {
  // Client is created on first access of .supabase — the import of
  // createServiceClient is safe at module-load time because it only reads
  // env vars when called, not when imported.
  let _supabase: ReturnType<typeof createServiceClient> | null = null;
  const tracked: { table: string; id: string }[] = [];

  return {
    get supabase(): ReturnType<typeof createServiceClient> {
      if (!_supabase) {
        _supabase = createServiceClient();
      }
      return _supabase;
    },
    track(table: string, id: string) {
      tracked.push({ table, id });
    },
    async cleanup() {
      if (!_supabase) return;
      const client = _supabase as any;
      for (const { table, id } of [...tracked].reverse()) {
        await client.from(table).delete().eq("id", id);
      }
      tracked.length = 0;
    },
  };
}
