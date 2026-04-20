import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dsrMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261020000000_dsr_requests.sql"),
  "utf8",
);
const dsrHelper = readFileSync(
  join(process.cwd(), "src/lib/compliance/dsr.ts"),
  "utf8",
);
const exportRoute = readFileSync(
  join(process.cwd(), "src/app/api/user/export-data/route.ts"),
  "utf8",
);
const deleteRoute = readFileSync(
  join(process.cwd(), "src/app/api/user/delete-account/route.ts"),
  "utf8",
);
const privacyPage = readFileSync(
  join(process.cwd(), "src/app/privacy/page.tsx"),
  "utf8",
);
const ferpaDoc = readFileSync(
  join(process.cwd(), "docs/FERPA_COMPLIANCE.md"),
  "utf8",
);

describe("DSR intake schema", () => {
  it("creates the dsr_requests table with routing and identifier evidence", () => {
    assert.match(dsrMigration, /CREATE TABLE public\.dsr_requests/i);
    assert.match(dsrMigration, /school_owner_user_id uuid/i);
    assert.match(dsrMigration, /requester_relationship text not null/i);
    assert.match(dsrMigration, /acknowledgement_method text/i);
    assert.match(dsrMigration, /resolution_method text/i);
    assert.match(dsrMigration, /\bsource text not null\b/i);
    assert.match(dsrMigration, /subject_identifier text/i);
    assert.match(dsrMigration, /subject_identifier_type text/i);
    assert.match(dsrMigration, /deleted_at timestamptz/i);
  });

  it("locks read access to org admins, compliance role, and service role", () => {
    assert.match(dsrMigration, /CREATE POLICY dsr_requests_admin_read/i);
    assert.match(dsrMigration, /public\.is_org_admin\(organization_id\)/i);
    assert.match(dsrMigration, /CREATE POLICY dsr_requests_compliance_read/i);
    assert.match(dsrMigration, /has_dsr_compliance_role/i);
    assert.match(dsrMigration, /CREATE POLICY dsr_requests_service_only/i);
    assert.match(dsrMigration, /\(SELECT auth\.role\(\)\) = 'service_role'/i);
  });

  it("adds a due-soon reporting function restricted to service_role", () => {
    assert.match(dsrMigration, /CREATE OR REPLACE FUNCTION public\.get_dsr_requests_due_soon/i);
    assert.match(dsrMigration, /now\(\) >= open_requests\.escalation_threshold/i);
    assert.match(dsrMigration, /REVOKE EXECUTE ON FUNCTION public\.get_dsr_requests_due_soon/i);
    assert.match(dsrMigration, /GRANT EXECUTE ON FUNCTION public\.get_dsr_requests_due_soon\(UUID, INTEGER\) TO service_role;/i);
    assert.match(dsrHelper, /export async function getDsrRequestsDueSoon/i);
  });
});

describe("DSR intake wiring", () => {
  it("records self-service export requests in the unified DSR log", () => {
    assert.match(exportRoute, /await createDsrRequest\(/);
    assert.match(exportRoute, /requestType:\s*"export"/);
    assert.match(exportRoute, /source:\s*"student_self"/);
    assert.match(exportRoute, /resolutionMethod:\s*"portal"/);
  });

  it("records self-service deletion requests in the unified DSR log", () => {
    assert.match(deleteRoute, /await createDsrRequest\(/);
    assert.match(deleteRoute, /requestType:\s*"delete"/);
    assert.match(deleteRoute, /acknowledgementMethod:\s*"portal"/);
    assert.match(deleteRoute, /linkedDeletionRequestId:/);
  });
});

describe("FERPA public surface", () => {
  it("links parent notification and New York rights material from /privacy", () => {
    assert.match(privacyPage, /\/privacy\/parent-notification/);
    assert.match(privacyPage, /\/privacy\/parents-bill-of-rights/);
    assert.match(privacyPage, /school remains the records holder for FERPA purposes/i);
    assert.match(privacyPage, /privacy@myteamnetwork\.com/i);
  });

  it("updates the FERPA guide to reference live DSR tracking and tests", () => {
    assert.match(ferpaDoc, /tests\/compliance\/dsr-intake\.test\.ts/);
    assert.doesNotMatch(ferpaDoc, /dsr_requests table would tighten reporting — deferred/i);
  });
});
