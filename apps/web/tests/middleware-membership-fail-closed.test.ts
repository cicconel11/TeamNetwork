import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("middleware fails closed when org membership verification errors", () => {
  const source = readSource("src/middleware.ts");
  const orgRouteSection = source.slice(
    source.indexOf("if (isOrgRoute(pathname) && user)"),
    source.indexOf("// ── Locale cookie sync ──")
  );

  assert.match(orgRouteSection, /const \{ data: org, error: orgError \}/);
  assert.match(orgRouteSection, /if \(orgError\) \{\s*throw orgError;/);
  assert.match(orgRouteSection, /const \{ data: membership, error: membershipError \}/);
  assert.match(orgRouteSection, /if \(membershipError\) \{\s*throw membershipError;/);
  assert.match(orgRouteSection, /get_org_context_by_slug returned an invalid payload/);
  assert.match(orgRouteSection, /Error checking membership status, failing closed/);
  assert.match(
    orgRouteSection,
    /return NextResponse\.redirect\(new URL\("\/app\?error=org_access_check_failed", request\.url\)\);/
  );
  assert.doesNotMatch(orgRouteSection, /don't block the request/i);
});
