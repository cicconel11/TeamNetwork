import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Regression tests pinning that BOTH upload-intent surfaces actually call
// checkStorageQuota and return HTTP 507 with the STORAGE_QUOTA_EXCEEDED code
// when the org is over its cap. If either of these gets refactored away the
// quota silently stops enforcing.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

function assertWiresQuota(rel: string) {
  const source = read(rel);
  assert.ok(
    /from\s+"@\/lib\/media\/storage-quota"/.test(source),
    `${rel} must import from @/lib/media/storage-quota`,
  );
  assert.ok(
    /checkStorageQuota\(/.test(source),
    `${rel} must call checkStorageQuota()`,
  );
  assert.ok(
    source.includes("STORAGE_QUOTA_EXCEEDED"),
    `${rel} must emit STORAGE_QUOTA_EXCEEDED code on rejection`,
  );
  assert.ok(
    /status:\s*507/.test(source),
    `${rel} must return HTTP 507 (Insufficient Storage) on quota rejection`,
  );
  assert.ok(
    /lookup_failed/.test(source),
    `${rel} must fail closed (handle reason: 'lookup_failed') instead of silently allowing`,
  );
}

test("feature upload-intent route enforces storage quota", () => {
  assertWiresQuota("src/app/api/media/upload-intent/route.ts");
});

test("gallery upload-intent route enforces storage quota", () => {
  assertWiresQuota("src/app/api/media/route.ts");
});

test("media page renders the admin-only storage usage bar", () => {
  const source = read("src/app/[orgSlug]/media/page.tsx");
  assert.ok(
    source.includes("MediaStorageUsageBar"),
    "media page must render <MediaStorageUsageBar>",
  );
  assert.ok(
    /<MediaStorageUsageBar[\s\S]*?isAdmin=\{isAdmin\}/.test(source),
    "MediaStorageUsageBar must receive the admin flag so non-admins don't see the bar",
  );
});
