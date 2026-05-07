import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("user data export emits provider-agnostic calendar connection fields", () => {
  const source = readFileSync(
    new URL("../src/app/api/user/export-data/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /calendarConnections:\s*Array<\{\s*provider: string;\s*providerEmail: string \| null;/);
  assert.match(source, /provider:\s*c\.provider,/);
  assert.match(source, /providerEmail:\s*c\.provider_email,/);
  assert.doesNotMatch(source, /googleEmail:\s*c\.provider_email,/);
});
