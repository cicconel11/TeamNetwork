import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

test("feature finalize validates preview blobs only when a preview path exists", () => {
  const source = readRepoFile("src/app/api/media/finalize/route.ts");

  assert.match(source, /if \(media\.preview_storage_path\)/);
  assert.match(source, /validateMagicBytes\(previewHeaderBytes,\s*previewMimeType\)/);
  assert.match(source, /\[media\.storage_path, media\.preview_storage_path\]\.filter/);
});

test("gallery finalize keeps legacy no-preview rows compatible while validating preview uploads", () => {
  const source = readRepoFile("src/app/api/media/[mediaId]/finalize/route.ts");

  assert.match(source, /select\("id, storage_path, preview_storage_path, mime_type, uploaded_by, status, organization_id"\)/);
  assert.match(source, /if \(item\.preview_storage_path\)/);
  assert.match(source, /validateMagicBytes\(previewBuffer,\s*previewMimeType\)/);
  assert.match(source, /\[item\.storage_path, item\.preview_storage_path\]\.filter/);
});

test("media cleanup cron removes preview objects alongside originals", () => {
  const source = readRepoFile("src/app/api/cron/media-cleanup/route.ts");

  assert.match(source, /select\("id, storage_path, preview_storage_path"\)/);
  assert.match(source, /\[upload\.storage_path, upload\.preview_storage_path\]/);
});
