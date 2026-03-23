import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";

const likeButtonSrc = readFileSync("src/components/feed/LikeButton.tsx", "utf-8");
const feedPageSrc = readFileSync("src/app/[orgSlug]/page.tsx", "utf-8");

describe("LikeButton prop sync (likes persist across navigation)", () => {
  it("syncs liked state from server props via useEffect", () => {
    assert.ok(
      likeButtonSrc.includes("useEffect"),
      "LikeButton must use useEffect to re-sync state from server props"
    );
    // The useEffect should reference initialLiked to sync when props change
    assert.match(
      likeButtonSrc,
      /useEffect\(\s*\(\)\s*=>\s*\{[^}]*setLiked/s,
      "useEffect must call setLiked to sync liked state from props"
    );
  });

  it("syncs count state from server props via useEffect", () => {
    assert.match(
      likeButtonSrc,
      /useEffect\(\s*\(\)\s*=>\s*\{[^}]*setCount/s,
      "useEffect must call setCount to sync count state from props"
    );
  });

  it("guards prop sync with isLoading to avoid clobbering in-flight optimistic updates", () => {
    // Both useEffects should check isLoading before syncing
    const effectBlocks = likeButtonSrc.match(/useEffect\(\s*\(\)\s*=>\s*\{[^}]*\}/gs) || [];
    const syncEffects = effectBlocks.filter(
      (block) => block.includes("setLiked") || block.includes("setCount")
    );
    for (const effect of syncEffects) {
      assert.ok(
        effect.includes("isLoading"),
        "Sync useEffect must be guarded by isLoading to protect in-flight optimistic updates"
      );
    }
  });

  it("reads API response body to reconcile server state after toggle", () => {
    assert.ok(
      likeButtonSrc.includes("response.json()"),
      "Toggle handler must read response.json() to reconcile with server state"
    );
  });
});

describe("Feed page likes query error handling", () => {
  it("captures error from feed_likes query", () => {
    // The destructuring should include error
    assert.match(
      feedPageSrc,
      /\{\s*data:\s*likes\s*,\s*error:\s*likesError\s*\}/,
      "feed_likes query must destructure error alongside data"
    );
  });

  it("logs the error when likes query fails", () => {
    assert.ok(
      feedPageSrc.includes("likesError"),
      "Page must reference likesError for logging/handling"
    );
  });
});
