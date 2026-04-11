import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("TeamGoogleCalendarConnect only treats a Google connection as satisfying the connect gate", () => {
  const source = readFileSync(
    new URL("../src/components/schedules/import/TeamGoogleCalendarConnect.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /\.from\("user_calendar_connections"\)[\s\S]*?\.eq\("user_id", user\.id\)[\s\S]*?\.eq\("provider", "google"\)[\s\S]*?\.maybeSingle\(\)/,
  );
});
