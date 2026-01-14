/**
 * SOURCE-LEVEL SECURITY REGRESSION TESTS
 *
 * These tests intentionally assert against source code patterns (not runtime behavior)
 * to catch security regressions that could be introduced by refactoring:
 * - No select('*') on alumni routes (prevents leaking new columns)
 * - No spread operators on DB rows (prevents leaking internal fields)
 * - No attacker-controlled Origin header in billing portal
 * - No DB error message leakage in response bodies
 *
 * FRAGILITY: These tests will break on column reordering, whitespace changes, or
 * variable renames. When they break, verify the security property still holds and
 * update the assertion string. Do NOT delete these tests without replacing the
 * security check with an equivalent behavioral test.
 */

import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function squishWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

test("adopt route propagates status from createAdoptionRequest", () => {
  const source = readSource("src/app/api/enterprise/[enterpriseId]/adopt/route.ts");
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes("return respond({ error: result.error }, result.status ?? 400);"),
    "adopt route must propagate status for infra/server failures"
  );
});

test("billing portal route does not trust Origin header", () => {
  const source = readSource("src/app/api/enterprise/[enterpriseId]/billing/portal/route.ts");
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes("process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin"),
    "billing portal must use server-controlled origin"
  );
  assert.strictEqual(
    source.includes('req.headers.get("origin")'),
    false,
    "billing portal must never use attacker-controlled Origin header"
  );
});

test("alumni list route uses explicit column list and no spread", () => {
  const source = readSource("src/app/api/enterprise/[enterpriseId]/alumni/route.ts");
  const normalized = squishWhitespace(source);

  assert.strictEqual(source.includes('.select("*"'), false, "alumni list must not use select('*')");
  assert.strictEqual(/\.\.\.alum\b/.test(source), false, "alumni list response must not spread DB row");
  assert.ok(
    normalized.includes(
      '.select("id, organization_id, first_name, last_name, email, phone_number, photo_url, linkedin_url, notes, graduation_year, major, industry, current_company, current_city, position_title, job_title", { count: "exact" })'
    ),
    "alumni list must keep explicit selected columns"
  );
});

test("alumni export route uses explicit column list and no spread", () => {
  const source = readSource("src/app/api/enterprise/[enterpriseId]/alumni/export/route.ts");
  const normalized = squishWhitespace(source);

  assert.strictEqual(source.includes('.select("*"'), false, "alumni export must not use select('*')");
  assert.strictEqual(/\.\.\.alum\b/.test(source), false, "alumni export response must not spread DB row");
  assert.ok(
    normalized.includes(
      '.select("id, organization_id, first_name, last_name, email, phone_number, photo_url, linkedin_url, notes, graduation_year, major, industry, current_company, current_city, position_title, job_title")'
    ),
    "alumni export must keep explicit selected columns"
  );
});

test("createEnterpriseSubOrg helper returns generic org/role errors (no DB detail leak)", () => {
  const source = readSource("src/lib/enterprise/create-sub-org.ts");

  assert.strictEqual(source.includes("orgError?.message"), false, "org insert DB error must not leak");
  assert.strictEqual(source.includes("roleError.message"), false, "role insert DB error must not leak");
  assert.ok(
    source.includes('error: "Unable to create organization"'),
    "helper must return generic organization creation failure message"
  );
  assert.ok(
    source.includes('error: "Failed to assign admin role"'),
    "helper must return generic role assignment failure message"
  );
});

test("create-with-upgrade route delegates to shared helper (no inline DB writes)", () => {
  const source = readSource("src/app/api/enterprise/[enterpriseId]/organizations/create-with-upgrade/route.ts");

  assert.strictEqual(source.includes("orgError?.message"), false, "route must not contain DB error references");
  assert.strictEqual(source.includes("roleError.message"), false, "route must not contain DB error references");
  assert.ok(
    source.includes("createEnterpriseSubOrg"),
    "route must delegate org creation to shared helper"
  );
});
