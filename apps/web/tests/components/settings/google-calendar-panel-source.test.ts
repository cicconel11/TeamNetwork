import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(process.cwd(), "src/components/settings/GoogleCalendarSyncPanel.tsx"),
  "utf-8",
);

describe("GoogleCalendarSyncPanel source (post-migration)", () => {
  it("does not use useAutoDismiss", () => {
    assert.doesNotMatch(src, /useAutoDismiss/);
  });

  it("uses showFeedback for transient notifications", () => {
    assert.match(src, /showFeedback/);
  });

  it("uses InlineBanner for inline errors", () => {
    assert.match(src, /InlineBanner/);
  });
});
