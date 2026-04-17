import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

function readMigration(filename: string): string {
  return readFileSync(join(MIGRATIONS_DIR, filename), "utf-8");
}

describe("user_onboarding_progress migration contract", () => {
  const MIGRATION_FILE = "20261018000000_user_onboarding_progress.sql";
  // Read at describe scope so all it() blocks have access
  const sql = readMigration(MIGRATION_FILE);

  it("migration file exists and is non-empty", () => {
    assert.ok(sql.length > 0, "Migration file must be non-empty");
  });

  it("creates user_onboarding_progress table", () => {
    assert.ok(
      sql.includes("CREATE TABLE user_onboarding_progress"),
      "Must create user_onboarding_progress table"
    );
  });

  it("has user_id referencing auth.users", () => {
    assert.ok(
      sql.includes("user_id") && sql.includes("auth.users"),
      "Must reference auth.users for user_id"
    );
  });

  it("has organization_id with cascade delete", () => {
    assert.ok(
      sql.includes("organization_id") && sql.includes("ON DELETE CASCADE"),
      "Must have organization_id with ON DELETE CASCADE"
    );
  });

  it("has completed_items jsonb column with default empty array", () => {
    assert.ok(
      sql.includes("completed_items") && sql.includes("jsonb"),
      "Must have completed_items jsonb column"
    );
    assert.ok(
      sql.includes("'[]'::jsonb"),
      "Must default to empty JSON array"
    );
  });

  it("has visited_items jsonb column", () => {
    assert.ok(
      sql.includes("visited_items"),
      "Must have visited_items column"
    );
  });

  it("has welcome_seen_at column", () => {
    assert.ok(
      sql.includes("welcome_seen_at"),
      "Must have welcome_seen_at timestamptz column"
    );
  });

  it("has tour_completed_at column", () => {
    assert.ok(
      sql.includes("tour_completed_at"),
      "Must have tour_completed_at timestamptz column"
    );
  });

  it("has dismissed_at column", () => {
    assert.ok(
      sql.includes("dismissed_at"),
      "Must have dismissed_at timestamptz column"
    );
  });

  it("has unique constraint on (user_id, organization_id)", () => {
    assert.ok(
      sql.includes("UNIQUE(user_id, organization_id)"),
      "Must have unique constraint on (user_id, organization_id)"
    );
  });

  it("enables row level security", () => {
    assert.ok(
      sql.includes("ENABLE ROW LEVEL SECURITY"),
      "Must enable RLS"
    );
  });

  it("has select policy for auth.uid()", () => {
    assert.ok(
      sql.includes("onboarding_progress_select") && sql.includes("auth.uid()"),
      "Must have a select RLS policy checking auth.uid()"
    );
  });

  it("has insert policy with check", () => {
    assert.ok(
      sql.includes("onboarding_progress_insert"),
      "Must have insert RLS policy"
    );
  });

  it("has update policy", () => {
    assert.ok(
      sql.includes("onboarding_progress_update"),
      "Must have update RLS policy"
    );
  });

  it("attaches updated_at trigger", () => {
    assert.ok(
      sql.includes("user_onboarding_progress_updated_at") &&
        sql.includes("update_updated_at_column"),
      "Must attach updated_at trigger using existing update_updated_at_column()"
    );
  });

  it("creates index on user_id, organization_id", () => {
    assert.ok(
      sql.includes("idx_onboarding_progress_user_org"),
      "Must create index idx_onboarding_progress_user_org"
    );
  });
});
