/**
 * Regression test: handle_org_member_sync must handle 'revoked' status
 *
 * Bug: Migration 20261015100000 replaced handle_org_member_sync but removed the
 * early-return for status='revoked'. The trigger then tried to cast 'revoked'
 * to member_status (which only has active/inactive/pending), causing a DB error
 * and a 500 "Failed to update member" response.
 *
 * Fix: Migration 20261021100000 restores the revoked early-return.
 *
 * This test reads the latest migration SQL to verify the guard is present,
 * preventing future regressions from the same pattern (redefining the trigger
 * function without carrying forward the revoked handler).
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "fs";
import { join } from "path";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20261021100000_fix_sync_trigger_revoked_regression.sql",
);

describe("handle_org_member_sync — revoked regression guard", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");

  it("migration defines handle_org_member_sync", () => {
    assert.ok(
      sql.includes("handle_org_member_sync"),
      "migration must redefine handle_org_member_sync",
    );
  });

  it("includes SET search_path = '' for security", () => {
    assert.ok(
      sql.includes("SET search_path = ''"),
      "function must set search_path to empty for SECURITY DEFINER safety",
    );
  });

  it("early-returns for revoked status before member_status cast", () => {
    const revokedGuardIndex = sql.indexOf("IF NEW.status = 'revoked'");
    const memberStatusCastIndex = sql.indexOf("::public.member_status");

    assert.ok(
      revokedGuardIndex !== -1,
      "must have a guard for NEW.status = 'revoked'",
    );
    assert.ok(
      memberStatusCastIndex !== -1,
      "must have member_status cast for non-revoked path",
    );
    assert.ok(
      revokedGuardIndex < memberStatusCastIndex,
      "revoked guard must appear BEFORE member_status cast to prevent enum error",
    );
  });

  it("revoked handler soft-deletes members records", () => {
    // Extract the revoked block (between the IF and its RETURN NEW)
    const revokedStart = sql.indexOf("IF NEW.status = 'revoked'");
    const revokedEnd = sql.indexOf("RETURN NEW;", revokedStart);
    const revokedBlock = sql.slice(revokedStart, revokedEnd);

    assert.ok(
      revokedBlock.includes("UPDATE public.members"),
      "revoked block must soft-delete members records",
    );
    assert.ok(
      revokedBlock.includes("deleted_at = now()"),
      "revoked block must set deleted_at",
    );
  });

  it("revoked handler soft-deletes alumni records for alumni role", () => {
    const revokedStart = sql.indexOf("IF NEW.status = 'revoked'");
    const revokedEnd = sql.indexOf("RETURN NEW;", revokedStart);
    const revokedBlock = sql.slice(revokedStart, revokedEnd);

    assert.ok(
      revokedBlock.includes("UPDATE public.alumni"),
      "revoked block must soft-delete alumni records when role is alumni",
    );
  });

  it("revoked handler soft-deletes parents records for parent role", () => {
    const revokedStart = sql.indexOf("IF NEW.status = 'revoked'");
    const revokedEnd = sql.indexOf("RETURN NEW;", revokedStart);
    const revokedBlock = sql.slice(revokedStart, revokedEnd);

    assert.ok(
      revokedBlock.includes("UPDATE public.parents"),
      "revoked block must soft-delete parents records when role is parent",
    );
  });

  it("includes pending-skip guard", () => {
    assert.ok(
      sql.includes("IF NEW.status = 'pending'"),
      "must skip directory sync for pending users",
    );
  });
});
