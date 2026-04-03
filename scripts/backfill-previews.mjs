#!/usr/bin/env node

/**
 * Backfill preview images for media_items missing preview_storage_path.
 *
 * Downloads originals from Supabase Storage, resizes to 1024px max dimension
 * at 82% JPEG quality, uploads the preview, and updates the DB row.
 *
 * Prerequisites: npm install --no-save sharp
 * Usage: node --env-file=.env.local scripts/backfill-previews.mjs [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");
const BUCKET = "org-media";
const PREVIEW_MAX_EDGE = 1024;
const JPEG_QUALITY = 82;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const PAGE_SIZE = 100;

async function fetchImagesMissingPreviews() {
  const allRows = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("media_items")
      .select("id, storage_path, mime_type")
      .is("deleted_at", null)
      .eq("media_type", "image")
      .is("preview_storage_path", null)
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Query failed: ${error.message}`);
    }

    const rows = data ?? [];
    allRows.push(...rows);

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

function buildPreviewPath(storagePath) {
  return `${storagePath.replace(/\.[^.]+$/, "")}-preview.jpg`;
}

async function processItem(item) {
  const { id, storage_path } = item;
  const previewPath = buildPreviewPath(storage_path);

  // Download original
  const { data: downloadData, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(storage_path);

  if (downloadError || !downloadData) {
    console.error(`  SKIP ${id}: download failed — ${downloadError?.message ?? "no data"}`);
    return { id, status: "download_failed" };
  }

  // Resize with sharp
  const buffer = Buffer.from(await downloadData.arrayBuffer());
  let previewBuffer;
  try {
    previewBuffer = await sharp(buffer)
      .resize(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  } catch (err) {
    console.error(`  SKIP ${id}: resize failed — ${err.message}`);
    return { id, status: "resize_failed" };
  }

  if (DRY_RUN) {
    const savings = ((1 - previewBuffer.length / buffer.length) * 100).toFixed(1);
    console.log(`  DRY RUN ${id}: ${storage_path} → ${previewPath} (${savings}% smaller)`);
    return { id, status: "dry_run" };
  }

  // Upload preview
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(previewPath, previewBuffer, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (uploadError) {
    // 409 = file already exists in storage — still update the DB pointer
    const isConflict =
      uploadError.statusCode === "409" || uploadError.statusCode === 409 ||
      uploadError.message?.includes("already exists");
    if (!isConflict) {
      console.error(`  SKIP ${id}: upload failed — ${uploadError.message}`);
      return { id, status: "upload_failed" };
    }
    console.log(`  ${id}: preview already in storage, updating DB pointer`);
  }

  // Update DB row
  const { error: updateError } = await supabase
    .from("media_items")
    .update({ preview_storage_path: previewPath })
    .eq("id", id);

  if (updateError) {
    console.error(`  SKIP ${id}: DB update failed — ${updateError.message}`);
    return { id, status: "update_failed" };
  }

  const savings = ((1 - previewBuffer.length / buffer.length) * 100).toFixed(1);
  console.log(`  OK ${id}: ${previewPath} (${savings}% smaller)`);
  return { id, status: "ok" };
}

async function main() {
  console.log(`Backfill previews${DRY_RUN ? " (DRY RUN)" : ""}\n`);

  const items = await fetchImagesMissingPreviews();
  console.log(`Found ${items.length} images missing previews\n`);

  if (items.length === 0) return;

  const results = [];
  for (const item of items) {
    const result = await processItem(item);
    results.push(result);
  }

  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\nResults:`, counts);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
