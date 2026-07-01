import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Migration-contract test (CI has no live DB): assert the SECURITY guarantees of
// the consume_mobile_auth_handoff RPC + mobile_auth_handoffs table directly
// against the migration SQL text. These are the #323 incident invariants —
// single-use, expiry, service-role-only — that must never silently regress.
const migrationFile =
  "../supabase/migrations/20261229000000_mobile_auth_handoffs.sql";
const migration = readFileSync(new URL(migrationFile, import.meta.url), "utf8");

// Normalize whitespace so multi-line SQL clauses can be matched without being
// brittle about exact line breaks / indentation.
const normalized = migration.replace(/\s+/g, " ");

function countMatches(input: string, pattern: RegExp): number {
  return Array.from(input.matchAll(pattern)).length;
}

describe("mobile_auth_handoffs migration contract", () => {
  describe("consume_mobile_auth_handoff RPC", () => {
    it("is defined as SECURITY DEFINER with a pinned empty search_path", () => {
      assert.match(
        normalized,
        /CREATE OR REPLACE FUNCTION public\.consume_mobile_auth_handoff\(p_code_hash text\)[\s\S]*?SECURITY DEFINER/,
      );
      assert.match(normalized, /SET search_path TO ''/);
    });

    it("is single-use: guards consumed_at IS NULL and stamps consumed_at = now()", () => {
      // The claim UPDATE marks the row consumed...
      assert.match(normalized, /UPDATE public\.mobile_auth_handoffs SET consumed_at = now\(\)/);
      // ...and only ever selects a row that has NOT already been consumed, so a
      // second consume of the same code finds no row and returns nothing.
      assert.match(normalized, /consumed_at IS NULL/);
    });

    it("enforces expiry: only unexpired rows are eligible (expires_at > now())", () => {
      assert.match(normalized, /expires_at > now\(\)/);
    });

    it("is concurrency-safe: claims the row with FOR UPDATE SKIP LOCKED", () => {
      assert.match(normalized, /FOR UPDATE SKIP LOCKED/);
    });

    it("selects deterministically (oldest first) and a single row", () => {
      assert.match(normalized, /ORDER BY created_at ASC LIMIT 1/);
    });

    it("returns only the encrypted tokens (never plaintext) for the matched user", () => {
      assert.match(
        normalized,
        /RETURNS TABLE\(user_id uuid, encrypted_access_token text, encrypted_refresh_token text\)/,
      );
      assert.match(
        normalized,
        /RETURNING user_id, encrypted_access_token, encrypted_refresh_token/,
      );
    });
  });

  describe("execute grants are locked to service_role", () => {
    it("revokes EXECUTE from PUBLIC, anon, and authenticated", () => {
      assert.match(
        normalized,
        /REVOKE EXECUTE ON FUNCTION public\.consume_mobile_auth_handoff\(text\) FROM PUBLIC/,
      );
      assert.match(
        normalized,
        /REVOKE EXECUTE ON FUNCTION public\.consume_mobile_auth_handoff\(text\) FROM anon/,
      );
      assert.match(
        normalized,
        /REVOKE EXECUTE ON FUNCTION public\.consume_mobile_auth_handoff\(text\) FROM authenticated/,
      );
    });

    it("grants EXECUTE to service_role only (no broad re-grant)", () => {
      assert.match(
        normalized,
        /GRANT EXECUTE ON FUNCTION public\.consume_mobile_auth_handoff\(text\) TO service_role/,
      );
      // Exactly one GRANT EXECUTE on this function — proves no accidental
      // re-grant to anon/authenticated/PUBLIC sneaks in alongside it.
      assert.equal(
        countMatches(
          migration,
          /GRANT EXECUTE ON FUNCTION public\.consume_mobile_auth_handoff\(text\)/g,
        ),
        1,
        "expected a single GRANT EXECUTE, to service_role",
      );
      assert.doesNotMatch(
        normalized,
        /GRANT EXECUTE ON FUNCTION public\.consume_mobile_auth_handoff\(text\) TO (?:PUBLIC|anon|authenticated)/,
      );
    });
  });

  describe("mobile_auth_handoffs table", () => {
    it("stores only the SHA-256 code hash (unique), never the plaintext code", () => {
      assert.match(normalized, /code_hash text NOT NULL UNIQUE/);
      assert.doesNotMatch(normalized, /\bcode text NOT NULL\b/);
    });

    it("stores tokens encrypted and tracks single-use + expiry columns", () => {
      assert.match(normalized, /encrypted_access_token text NOT NULL/);
      assert.match(normalized, /encrypted_refresh_token text NOT NULL/);
      assert.match(normalized, /expires_at timestamptz NOT NULL/);
      assert.match(normalized, /consumed_at timestamptz/);
    });

    it("enables RLS (no policies ⇒ no anon/authenticated table access)", () => {
      assert.match(
        normalized,
        /ALTER TABLE public\.mobile_auth_handoffs ENABLE ROW LEVEL SECURITY/,
      );
      // Defense in depth: the table is reachable only through the SECURITY
      // DEFINER function, so there must be no CREATE POLICY opening it up.
      assert.doesNotMatch(normalized, /CREATE POLICY[\s\S]*?ON public\.mobile_auth_handoffs/);
    });
  });
});
