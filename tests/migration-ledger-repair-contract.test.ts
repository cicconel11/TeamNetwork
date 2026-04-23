import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readMigration(filename: string): string {
  return readFileSync(join(process.cwd(), "supabase/migrations", filename), "utf8");
}

function assertLedgerSafeAdditiveMigration(sql: string, filename: string): void {
  assert.match(sql, /add column/i, `${filename} should be additive`);
  assert.doesNotMatch(sql, /create table/i, `${filename} should not create tables`);
  assert.doesNotMatch(sql, /create trigger/i, `${filename} should not create triggers`);
  assert.doesNotMatch(sql, /create or replace function/i, `${filename} should not define functions`);
  assert.doesNotMatch(sql, /\binsert into\b/i, `${filename} should not backfill data`);
  assert.doesNotMatch(sql, /^\s*update\b/im, `${filename} should not mutate existing rows`);
}

test("verified ledger-safe repairs stay limited to additive column migrations", () => {
  const aiSafety = readMigration("20261022000000_ai_audit_safety_columns.sql");
  const aiGrounding = readMigration("20261022100000_ai_audit_rag_grounding_columns.sql");
  const orgCaptcha = readMigration("20261023000000_add_org_captcha_provider.sql");

  assert.match(aiSafety, /ALTER TABLE public\.ai_audit_log/i);
  assert.match(aiSafety, /ADD COLUMN IF NOT EXISTS safety_verdict/i);
  assertLedgerSafeAdditiveMigration(aiSafety, "20261022000000_ai_audit_safety_columns.sql");

  assert.match(aiGrounding, /ALTER TABLE public\.ai_audit_log/i);
  assert.match(aiGrounding, /ADD COLUMN IF NOT EXISTS rag_grounded/i);
  assertLedgerSafeAdditiveMigration(aiGrounding, "20261022100000_ai_audit_rag_grounding_columns.sql");

  assert.match(orgCaptcha, /ALTER TABLE organizations/i);
  assert.match(orgCaptcha, /ADD COLUMN captcha_provider/i);
  assertLedgerSafeAdditiveMigration(orgCaptcha, "20261023000000_add_org_captcha_provider.sql");
});

test("mixed-state migrations remain operator-only and must not be ledger-repaired blindly", () => {
  const mentorshipNative = readMigration("20261019000000_mentorship_native_tables.sql");
  const enterpriseCounts = readMigration("20261020200002_enterprise_counts_function.sql");
  const donationStatsTrigger = readMigration("20261020100000_donation_stats_sync_trigger.sql");

  assert.match(
    mentorshipNative,
    /create table if not exists public\.mentee_preferences/i,
    "native mentorship migration creates a table and cannot be classified by ledger guesswork",
  );
  assert.match(
    mentorshipNative,
    /\binsert into public\.mentee_preferences\b/i,
    "native mentorship migration also backfills data",
  );

  assert.match(
    enterpriseCounts,
    /create or replace function public\.get_enterprise_counts/i,
    "enterprise counts migration changes executable database behavior",
  );

  assert.match(
    donationStatsTrigger,
    /create trigger organization_donations_sync_stats/i,
    "donation stats sync migration installs a trigger",
  );
  assert.match(
    donationStatsTrigger,
    /\binsert into public\.organization_donation_stats\b/i,
    "donation stats sync migration backfills aggregate rows",
  );
  assert.match(
    donationStatsTrigger,
    /^\s*update public\.organization_donation_stats/im,
    "donation stats sync migration rewrites existing aggregate rows",
  );
});
