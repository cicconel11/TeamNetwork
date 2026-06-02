#!/usr/bin/env node
/**
 * Migration drift check.
 *
 * Fails when a migration committed to the repo (supabase/migrations/*.sql) was
 * never applied to the target Supabase project's ledger. This is the guard that
 * stops a committed-but-unapplied migration from silently shipping — the exact
 * failure mode that left init_ai_chat, the feedback-screenshots lockdown, and
 * the wallet table out of prod while their app code merged.
 *
 * How it reads the ledger: supabase_migrations.schema_migrations is not exposed
 * via PostgREST, so we call the public.applied_migration_versions() SECURITY
 * DEFINER RPC (service_role only) added in 20261214000000.
 *
 * Soft-skip: when SUPABASE_SERVICE_ROLE_KEY / URL are unset (e.g. fork PRs with
 * no secrets), this exits 0 with a notice — matching the repo convention where
 * DB-touching CI work skips rather than fails without credentials. The job is
 * still wired into All Checks so it runs wherever secrets are present.
 *
 * Known-gap allowlist: KNOWN_UNAPPLIED holds versions deliberately not yet
 * applied to prod (tracked follow-ups). Each entry MUST carry a reason. Remove
 * an entry once its migration is applied — a stale allowlist entry is itself a
 * drift the next maintainer will trip over.
 */

const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");

// Versions intentionally NOT applied to prod yet (genuine deferred gaps found in
// the 2026-06 ledger reconciliation). Keep reasons; delete entries when applied.
const KNOWN_UNAPPLIED = new Map([
  ["20260402120000", "ai-schedule-uploads bucket: 4 storage RLS policies absent in prod (deferred)"],
  ["20261024000000", "ai_cache_hit_rate_daily view absent in prod (deferred, admin metrics only)"],
  ["20261105000000", "claim_alumni_profiles() no-arg hardening absent (2-arg still live, deferred)"],
  ["20261206000001", "wallet_pass_registrations table absent in prod (deferred, feature gated)"],
]);

function repoVersions() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .map((f) => f.match(/^(\d+)_/)[1])
    .reduce((set, v) => set.add(v), new Set());
}

async function appliedVersions(url, key) {
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("applied_migration_versions");
  if (error) {
    throw new Error(
      `Failed to read migration ledger via applied_migration_versions(): ${error.message}. ` +
        `Ensure migration 20261214000000_applied_migration_versions_rpc.sql is applied to this project.`
    );
  }
  return new Set((data ?? []).map(String));
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.log(
      "::notice::Supabase credentials unset — skipping migration drift check (no ledger to compare against)."
    );
    process.exit(0);
  }

  const repo = repoVersions();
  const applied = await appliedVersions(url, key);

  const missing = [...repo]
    .filter((v) => !applied.has(v))
    .filter((v) => !KNOWN_UNAPPLIED.has(v))
    .sort();

  // Surface stale allowlist entries (migration now applied — allowlist lying).
  const staleAllowlist = [...KNOWN_UNAPPLIED.keys()].filter((v) => applied.has(v));

  if (staleAllowlist.length > 0) {
    console.error(
      "::error::Stale KNOWN_UNAPPLIED allowlist entries (these ARE applied now — remove them from check-migration-drift.js):\n" +
        staleAllowlist.map((v) => `  - ${v}`).join("\n")
    );
  }

  if (missing.length > 0) {
    console.error(
      `::error::Migration drift: ${missing.length} committed migration(s) are NOT applied to the target project:\n` +
        missing.map((v) => `  - ${v}`).join("\n") +
        "\n\nApply them (supabase db push / MCP apply_migration) and write the ledger row, " +
        "or add to KNOWN_UNAPPLIED with a reason if intentionally deferred."
    );
  }

  if (missing.length > 0 || staleAllowlist.length > 0) {
    process.exit(1);
  }

  console.log(
    `Migration drift check passed: ${repo.size} repo migrations, ${applied.size} applied, ` +
      `${KNOWN_UNAPPLIED.size} known-deferred.`
  );
}

main().catch((err) => {
  console.error(`::error::Migration drift check failed: ${err.message}`);
  process.exit(1);
});
