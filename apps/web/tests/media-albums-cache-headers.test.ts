import test from "node:test";
import assert from "node:assert/strict";
import { MEDIA_LIST_CACHE_HEADERS, MEDIA_CACHE_HEADERS } from "@/lib/media/urls";

test("MEDIA_LIST_CACHE_HEADERS forces revalidation so deletes show immediately", () => {
  assert.equal(
    MEDIA_LIST_CACHE_HEADERS["Cache-Control"],
    "private, max-age=0, must-revalidate",
  );
});

test("MEDIA_CACHE_HEADERS retains long max-age for item-level signed URLs", () => {
  // Long max-age stays useful for item routes that embed expensive signed URLs.
  assert.match(MEDIA_CACHE_HEADERS["Cache-Control"], /private, max-age=\d+/);
  const match = MEDIA_CACHE_HEADERS["Cache-Control"].match(/max-age=(\d+)/);
  assert.ok(match);
  assert.ok(Number(match![1]) > 0);
});
