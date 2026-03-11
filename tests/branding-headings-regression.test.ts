import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

/** Strip JSX comments so regex doesn't match commented-out code */
function stripJsxComments(source: string): string {
  return source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

test("landing page retains a semantic h1 alongside branded hero artwork", () => {
  const source = stripJsxComments(readRepoFile("src/app/page.tsx"));
  assert.match(source, /<h1[\s>]/, "expected src/app/page.tsx to contain an h1 (not commented out)");
  assert.match(source, /sr-only[^>]*>[^<]+/, "h1 must contain non-empty sr-only text");
});

test("app dashboard header retains a semantic h1", () => {
  const source = stripJsxComments(readRepoFile("src/app/app/page.tsx"));
  assert.match(source, /<h1[\s>]/, "expected src/app/app/page.tsx to contain an h1 (not commented out)");
});

test("shared auth header provides an h1 for auth entry pages", () => {
  const source = stripJsxComments(readRepoFile("src/components/auth/AuthHeader.tsx"));
  assert.match(source, /<h1[\s>]/, "expected AuthHeader to contain an h1 (not commented out)");
  assert.match(source, /sr-only[^>]*>[^<]+/, "AuthHeader h1 must contain non-empty sr-only text");
});

test("auth pages import and render AuthHeader", () => {
  const authPages = [
    "src/app/auth/login/page.tsx",
    "src/app/auth/signup/page.tsx",
    "src/app/auth/forgot-password/page.tsx",
    "src/app/auth/reset-password/page.tsx",
    "src/app/auth/parental-consent/page.tsx",
  ];
  for (const pagePath of authPages) {
    const source = readFileSync(path.join(process.cwd(), pagePath), "utf8");
    assert.match(source, /AuthHeader/, `${pagePath} must use AuthHeader`);
  }
});
