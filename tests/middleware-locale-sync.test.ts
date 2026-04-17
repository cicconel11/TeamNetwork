import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("middleware defines a 10-minute locale-sync TTL", () => {
  const source = readSource("src/middleware.ts");
  assert.match(source, /const LOCALE_SYNC_TTL_MS = 10 \* 60 \* 1000;/);
});

test("isLocaleCookieFresh requires both NEXT_LOCALE and NEXT_LOCALE_SYNCED_AT and enforces the TTL", () => {
  const source = readSource("src/middleware.ts");
  const helper = source.slice(
    source.indexOf("function isLocaleCookieFresh"),
    source.indexOf("const supabaseUrl")
  );
  assert.match(helper, /NEXT_LOCALE/);
  assert.match(helper, /NEXT_LOCALE_SYNCED_AT/);
  assert.match(helper, /Date\.now\(\) - ts < LOCALE_SYNC_TTL_MS/);
  assert.match(helper, /if \(!locale \|\| !syncedAt\) return false/);
});

test("syncLocaleCookie stamps NEXT_LOCALE_SYNCED_AT on every call", () => {
  const source = readSource("src/middleware.ts");
  const fn = source.slice(
    source.indexOf("function syncLocaleCookie"),
    source.indexOf("const supabaseUrl")
  );
  assert.match(fn, /response\.cookies\.set\("NEXT_LOCALE_SYNCED_AT"/);
  assert.match(fn, /request\.cookies\.set\("NEXT_LOCALE_SYNCED_AT"/);
});

test("middleware skips the three non-org locale DB reads when the cookie is fresh", () => {
  const source = readSource("src/middleware.ts");
  const localeSection = source.slice(
    source.indexOf("// ── Locale cookie sync ──"),
    source.indexOf("response.headers.set(\"x-pathname\"")
  );
  // Freshness guard wraps the DB reads
  assert.match(localeSection, /const skipLocaleDbReads = !isOrgRoute\(pathname\) && isLocaleCookieFresh\(request\)/);
  assert.match(localeSection, /if \(!isOrgRoute\(pathname\) && !skipLocaleDbReads\)/);
  // The three queries remain inside the guarded block
  assert.match(localeSection, /\.from\("users"\)\s*\n\s*\.select\("language_override"\)/);
  assert.match(localeSection, /\.from\("user_organization_roles"\)\s*\n\s*\.select\("organization_id"\)/);
  assert.match(localeSection, /\.from\("organizations"\)\s*\n\s*\.select\("default_language"\)/);
  // Fresh path re-stamps SYNCED_AT without touching NEXT_LOCALE
  assert.match(localeSection, /if \(skipLocaleDbReads\) \{/);
  assert.match(localeSection, /NEXT_LOCALE_SYNCED_AT/);
});

test("language settings page clears NEXT_LOCALE_SYNCED_AT alongside NEXT_LOCALE", () => {
  const source = readSource("src/app/settings/language/page.tsx");
  assert.match(source, /NEXT_LOCALE_SYNCED_AT=;path=\/;max-age=0/);
});

test("org customization page clears NEXT_LOCALE_SYNCED_AT alongside NEXT_LOCALE", () => {
  const source = readSource("src/app/[orgSlug]/customization/page.tsx");
  assert.match(source, /NEXT_LOCALE_SYNCED_AT=;path=\/;max-age=0/);
});

test("legacy fail-closed test marker is preserved", () => {
  const source = readSource("src/middleware.ts");
  assert.ok(source.includes("// ── Locale cookie sync ──"));
});
