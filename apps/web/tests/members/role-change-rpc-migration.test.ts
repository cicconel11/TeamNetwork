import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "../../supabase/migrations/20261204000000_create_execute_member_role_change_rpc.sql",
);

const sql = readFileSync(MIGRATION_PATH, "utf8");

describe("execute_member_role_change migration", () => {
  it("declares the function exactly once", () => {
    const matches = sql.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.execute_member_role_change/gi) ?? [];
    assert.equal(matches.length, 1, "expected one CREATE FUNCTION");
  });

  it("is SECURITY DEFINER with a pinned search_path", () => {
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET\s+search_path\s*=\s*public,\s*pg_temp/i);
  });

  it("revokes execute from PUBLIC, anon, and authenticated", () => {
    const revoke = sql.match(/REVOKE[^;]+FROM[^;]+;/i)?.[0] ?? "";
    assert.match(revoke, /PUBLIC/);
    assert.match(revoke, /\banon\b/);
    assert.match(revoke, /\bauthenticated\b/);
  });

  it("grants execute only to service_role", () => {
    const grant = sql.match(/GRANT\s+EXECUTE[^;]+TO[^;]+;/i)?.[0] ?? "";
    assert.match(grant, /\bservice_role\b/);
    assert.doesNotMatch(grant, /\bauthenticated\b/);
    assert.doesNotMatch(grant, /\banon\b/);
  });

  it("uses enum types for role and status parameters", () => {
    assert.match(sql, /p_previous_role\s+public\.user_role/);
    assert.match(sql, /p_new_role\s+public\.user_role/);
    assert.match(sql, /p_previous_status\s+public\.membership_status/);
    assert.match(sql, /p_new_status\s+public\.membership_status/);
  });

  it("raises P0002 when the membership row does not exist", () => {
    assert.match(sql, /IF\s+NOT\s+FOUND\s+THEN[^$]*RAISE\s+EXCEPTION[^$]*ERRCODE\s*=\s*'P0002'/i);
  });

  it("guards p_source against unexpected values", () => {
    assert.match(sql, /p_source\s+NOT IN\s*\(\s*'manual'\s*,\s*'ai_pending_action'\s*\)/i);
  });
});
