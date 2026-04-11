import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("all photos bulk delete disables ineligible selections and uses shared batched deletion", () => {
  const gallerySource = readFileSync(
    new URL("../src/components/media/MediaGallery.tsx", import.meta.url),
    "utf8",
  );

  assert.match(gallerySource, /selectionDisabled=\{/);
  assert.match(gallerySource, /getBulkDeleteEligibleIds|canDeleteMediaItem/);
  assert.match(gallerySource, /bulkDeleteSelectedMedia/);
  assert.doesNotMatch(gallerySource, /items\.filter\(\(i\) => selectedIds\.has\(i\.id\)\)\.every/);
});

test("album view bulk delete also uses shared batched deletion", () => {
  const albumViewSource = readFileSync(
    new URL("../src/components/media/AlbumView.tsx", import.meta.url),
    "utf8",
  );

  assert.match(albumViewSource, /bulkDeleteSelectedMedia/);
});
