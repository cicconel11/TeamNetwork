import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sanitizeRedirectPath } from "../src/lib/auth/redirect";

const fixMigration = readFileSync(
  new URL("../supabase/migrations/20261012130000_fix_compliance_regressions.sql", import.meta.url),
  "utf8",
);
const acceptTermsPageSource = readFileSync(
  new URL("../src/app/auth/accept-terms/page.tsx", import.meta.url),
  "utf8",
);
const acceptTermsRouteSource = readFileSync(
  new URL("../src/app/api/auth/accept-terms/route.ts", import.meta.url),
  "utf8",
);

describe("compliance regression coverage", () => {
  describe("privileged audit helpers", () => {
    it("revokes public-facing execute access from purge_old_data_access_logs", () => {
      assert.match(fixMigration, /REVOKE EXECUTE ON FUNCTION public\.purge_old_data_access_logs\(\) FROM public;/);
      assert.match(fixMigration, /REVOKE EXECUTE ON FUNCTION public\.purge_old_data_access_logs\(\) FROM anon;/);
      assert.match(fixMigration, /REVOKE EXECUTE ON FUNCTION public\.purge_old_data_access_logs\(\) FROM authenticated;/);
      assert.match(fixMigration, /GRANT EXECUTE ON FUNCTION public\.purge_old_data_access_logs\(\) TO service_role;/);
    });

    it("revokes public-facing execute access from backfill_ip_hashes", () => {
      assert.match(fixMigration, /REVOKE EXECUTE ON FUNCTION public\.backfill_ip_hashes\(text\) FROM public;/);
      assert.match(fixMigration, /REVOKE EXECUTE ON FUNCTION public\.backfill_ip_hashes\(text\) FROM anon;/);
      assert.match(fixMigration, /REVOKE EXECUTE ON FUNCTION public\.backfill_ip_hashes\(text\) FROM authenticated;/);
      assert.match(fixMigration, /GRANT EXECUTE ON FUNCTION public\.backfill_ip_hashes\(text\) TO service_role;/);
    });

    it("pins both new SECURITY DEFINER helpers to an empty search_path", () => {
      assert.match(
        fixMigration,
        /CREATE OR REPLACE FUNCTION public\.purge_old_data_access_logs\(\)[\s\S]*?SET search_path = ''/i,
      );
      assert.match(
        fixMigration,
        /CREATE OR REPLACE FUNCTION public\.backfill_ip_hashes\(salt text\)[\s\S]*?SET search_path = ''/i,
      );
    });
  });

  describe("accept-terms flow", () => {
    it("sanitizes redirect targets before reusing them", () => {
      assert.equal(sanitizeRedirectPath("https://evil.com"), "/app");
      assert.equal(sanitizeRedirectPath("//evil.com"), "/app");
      assert.equal(sanitizeRedirectPath("/app/join?token=123"), "/app/join?token=123");
    });

    it("uses sanitizeRedirectPath inside the accept-terms page", () => {
      assert.match(acceptTermsPageSource, /sanitizeRedirectPath/);
      assert.match(acceptTermsPageSource, /const safeRedirectTo = sanitizeRedirectPath/);
    });

    it("requires an explicit accepted=true payload when recording agreements", () => {
      assert.match(acceptTermsRouteSource, /validateJson/);
      assert.match(acceptTermsRouteSource, /accepted:\s*z\.literal\(true\)/);
    });
  });
});
