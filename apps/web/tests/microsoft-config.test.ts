import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("microsoft calendar build validation includes the shared token encryption key", () => {
  const source = readFileSync(path.join(repoRoot, "next.config.mjs"), "utf8");

  assert.match(
    source,
    /const microsoftCalendarEnv = \[\s*"MICROSOFT_CLIENT_ID",\s*"MICROSOFT_CLIENT_SECRET",\s*"GOOGLE_TOKEN_ENCRYPTION_KEY",\s*\]/s,
    "Outlook build validation should include the shared token encryption key required by microsoft oauth",
  );
});
