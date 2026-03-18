import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const oauthPath = path.resolve(
  import.meta.dirname,
  "..",
  "src",
  "lib",
  "linkedin",
  "oauth.ts",
);

const oauthSource = fs.readFileSync(oauthPath, "utf8");

test("rate-limit query selects last_enriched_url alongside last_enriched_at", () => {
  assert.match(
    oauthSource,
    /\.select\(["']last_enriched_at,\s*last_enriched_url["']\)/,
    "expected select to include last_enriched_url",
  );
});

test("rate-limit check compares canonicalized URLs to bypass cooldown on URL change", () => {
  assert.match(
    oauthSource,
    /normalizeLinkedInProfileUrl\(linkedinUrl\)/,
    "expected normalizeLinkedInProfileUrl call on the input URL",
  );
  assert.match(
    oauthSource,
    /normalizeLinkedInProfileUrl\(connRow\.last_enriched_url/,
    "expected normalizeLinkedInProfileUrl call on the stored URL",
  );
});

test("null last_enriched_url is treated as URL-changed (bypasses cooldown)", () => {
  assert.match(
    oauthSource,
    /last_enriched_url\s*==\s*null/,
    "expected == null check that treats missing URL as changed",
  );
  assert.doesNotMatch(
    oauthSource,
    /connRow\.last_enriched_url\s*\?\?\s*""/,
    "must not use ?? '' fallback — it causes null URLs to always appear changed",
  );
});

test("oauth.ts imports normalizeLinkedInProfileUrl from alumni/linkedin-url", () => {
  assert.match(
    oauthSource,
    /import\s*\{[^}]*normalizeLinkedInProfileUrl[^}]*\}\s*from\s*["']@\/lib\/alumni\/linkedin-url["']/,
    "expected import of normalizeLinkedInProfileUrl from @/lib/alumni/linkedin-url",
  );
  assert.doesNotMatch(
    oauthSource,
    /function\s+normalizeLinkedInUrl\b/,
    "old normalizeLinkedInUrl helper should be removed",
  );
});

test("RPC call canonicalizes linkedinUrl via normalizeLinkedInProfileUrl", () => {
  assert.match(
    oauthSource,
    /p_enriched_url:\s*normalizeLinkedInProfileUrl\(linkedinUrl\)/,
    "expected p_enriched_url to be canonicalized via normalizeLinkedInProfileUrl",
  );
});

test("URL-changed bypass wraps the cooldown check (rate-limit only fires when URL unchanged)", () => {
  // The urlChanged variable should be computed before the daysSince check
  const urlChangedIdx = oauthSource.indexOf("urlChanged");
  const daysSinceIdx = oauthSource.indexOf("daysSince", urlChangedIdx);
  assert.ok(urlChangedIdx > -1, "expected urlChanged variable");
  assert.ok(daysSinceIdx > urlChangedIdx, "daysSince check must come after urlChanged");

  // The cooldown block should be inside !urlChanged guard
  assert.match(
    oauthSource,
    /if\s*\(!urlChanged\)/,
    "expected !urlChanged guard around cooldown logic",
  );
});
