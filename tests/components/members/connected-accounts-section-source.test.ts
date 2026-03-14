import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_PATH = join(
  process.cwd(),
  "src/components/members/ConnectedAccountsSection.tsx",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf-8");
}

describe("ConnectedAccountsSection source", () => {
  it("is a client component", () => {
    const source = readSource();
    assert.ok(
      source.startsWith('"use client"'),
      "should start with 'use client' directive",
    );
  });

  it("imports LinkedInSettingsPanel", () => {
    const source = readSource();
    assert.match(
      source,
      /import[\s\S]*LinkedInSettingsPanel[\s\S]*from\s+["']@\/components\/settings\/LinkedInSettingsPanel["']/,
    );
  });

  it("imports GoogleCalendarSyncPanel", () => {
    const source = readSource();
    assert.match(
      source,
      /import.*GoogleCalendarSyncPanel.*from.*@\/components\/settings\/GoogleCalendarSyncPanel/,
    );
  });

  it("imports useGoogleCalendarSync hook", () => {
    const source = readSource();
    assert.match(
      source,
      /import.*useGoogleCalendarSync.*from.*@\/hooks\/useGoogleCalendarSync/,
    );
  });

  it("does not import useAutoDismiss", () => {
    const source = readSource();
    assert.doesNotMatch(source, /useAutoDismiss/);
  });

  it("imports showFeedback", () => {
    const source = readSource();
    assert.match(
      source,
      /import.*showFeedback.*from.*@\/lib\/feedback\/show-feedback/,
    );
  });

  it("renders a Connected Accounts heading", () => {
    const source = readSource();
    assert.match(source, /Connected Accounts/);
  });
});
