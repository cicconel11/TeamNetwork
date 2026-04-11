import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shouldUseNativeImage } from "@/components/ui/avatar-utils";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("remote avatar URLs bypass Next image optimization", () => {
  assert.equal(shouldUseNativeImage("https://cdn.example.com/avatar.jpg"), true);
  assert.equal(shouldUseNativeImage("data:image/png;base64,abc"), true);
  assert.equal(shouldUseNativeImage("/avatars/local.png"), false);
  assert.equal(shouldUseNativeImage("not a url"), false);
});

test("next image config does not wildcard arbitrary remote hosts", () => {
  const source = readFileSync(path.join(repoRoot, "next.config.mjs"), "utf8");

  assert.doesNotMatch(
    source,
    /hostname:\s*"\*\*"/,
    "remotePatterns must not allow all HTTPS hosts through the Next image optimizer",
  );
  assert.match(
    source,
    /"img-src 'self' blob: data: https:"/,
    "CSP should still allow browser-fetched HTTPS avatars",
  );
});
