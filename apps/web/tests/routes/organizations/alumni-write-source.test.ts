import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function squishWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

test("single-add alumni page posts through the organization alumni API", () => {
  const source = readSource("src/app/[orgSlug]/alumni/new/page.tsx");
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes('fetch(`/api/organizations/${organizationId}/alumni`, {'),
    "new alumni page must submit through the server alumni create route"
  );
  assert.strictEqual(
    source.includes('.from("alumni").insert('),
    false,
    "new alumni page must not insert alumni rows directly from the browser"
  );
});

test("edit alumni page has server-side auth gate and client form uses PATCH API", () => {
  const pageSource = readSource("src/app/[orgSlug]/alumni/[alumniId]/edit/page.tsx");
  const formSource = readSource("src/components/alumni/EditAlumniForm.tsx");
  const formNormalized = squishWhitespace(formSource);

  assert.ok(
    pageSource.includes("checkOrgReadOnly"),
    "edit page server component must check read-only state"
  );
  assert.ok(
    pageSource.includes("notFound()"),
    "edit page server component must block unauthorized users with notFound()"
  );
  assert.ok(
    formNormalized.includes('fetch( `/api/organizations/${alumni.organization_id}/alumni/${alumniId}`,'),
    "edit alumni form must submit through the server alumni update route"
  );
  assert.strictEqual(
    formSource.includes('.from("alumni").update('),
    false,
    "edit alumni form must not update alumni rows directly from the browser"
  );
});

test("alumni detail page uses the delete helper instead of SoftDeleteButton", () => {
  const source = readSource("src/app/[orgSlug]/alumni/[alumniId]/page.tsx");
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes('import { DeleteAlumniButton } from "@/components/alumni/DeleteAlumniButton";'),
    "detail page must use the alumni-specific delete helper"
  );
  assert.ok(
    normalized.includes("<DeleteAlumniButton"),
    "detail page must render the alumni-specific delete helper"
  );
  assert.strictEqual(
    source.includes("SoftDeleteButton"),
    false,
    "detail page must not use raw client-side soft delete for alumni"
  );
});

test("create route keeps alumni creation allowed during grace period", () => {
  const source = readSource("src/app/api/organizations/[organizationId]/alumni/route.ts");
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes('action: "create",'),
    "create route must evaluate the create mutation policy"
  );
  assert.ok(
    normalized.includes("isReadOnly: false,"),
    "create route must not inherit the read-only block used for other alumni mutations"
  );
  assert.strictEqual(
    source.includes("checkOrgReadOnly"),
    false,
    "create route must not call the shared read-only guard"
  );
});

test("update and delete routes enforce read-only mode server-side", () => {
  const source = readSource("src/app/api/organizations/[organizationId]/alumni/[alumniId]/route.ts");
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes("const { isReadOnly } = await checkOrgReadOnly(organizationId);"),
    "update/delete route must verify grace-period read-only state on the server"
  );
  assert.ok(
    normalized.includes("return NextResponse.json(readOnlyResponse(), { status: 403 });"),
    "update/delete route must reject edits and deletes when the org is read-only"
  );
});

test("standalone alumni quota reads organization_subscriptions.alumni_bucket", () => {
  const source = readSource("src/lib/alumni-quota.ts");

  assert.ok(
    source.includes('.select("alumni_bucket")'),
    "standalone quota lookup must read the real alumni_bucket column"
  );
  assert.strictEqual(
    source.includes("alumni_quota_tier"),
    false,
    "standalone quota lookup must not reference the removed alumni_quota_tier column"
  );
});

test("bulk LinkedIn import upgrade migration uses alumni_bucket for standalone org quota", () => {
  const source = readSource("supabase/migrations/20260306213000_fix_bulk_linkedin_import_quota_column.sql");

  assert.ok(
    source.includes("public.alumni_bucket_limit(os.alumni_bucket)"),
    "bulk LinkedIn import RPC must use organization_subscriptions.alumni_bucket"
  );
  assert.strictEqual(
    source.includes("alumni_quota_tier"),
    false,
    "bulk LinkedIn import RPC must not reference alumni_quota_tier"
  );
});
