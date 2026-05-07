import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");

function getMigrationFiles(): string[] {
  return fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function findLatestPreviewStorageMigration(): string {
  const files = getMigrationFiles();
  let latest = "";

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    if (!/ALTER TABLE public\.media_uploads[\s\S]*preview_storage_path/i.test(sql)) continue;
    if (!/ALTER TABLE public\.media_items[\s\S]*preview_storage_path/i.test(sql)) continue;
    latest = file;
  }

  assert.ok(latest, "Expected a migration that adds preview_storage_path to media_uploads and media_items");
  return latest;
}

test("media preview storage migration sorts after the media tables exist", () => {
  const file = findLatestPreviewStorageMigration();

  assert.ok(
    file > "20260528000000_create_media_uploads.sql",
    `${file}: must sort after 20260528000000_create_media_uploads.sql because it alters public.media_uploads`
  );
  assert.ok(
    file > "20260601000000_create_media_archive.sql",
    `${file}: must sort after 20260601000000_create_media_archive.sql because it alters public.media_items`
  );
});
