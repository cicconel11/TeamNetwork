import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("default web dev command starts from a clean Next cache", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };

  assert.equal(packageJson.scripts?.dev, "rm -rf .next && next dev");
  assert.equal(packageJson.scripts?.["dev:clean"], packageJson.scripts?.dev);
});
