import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_PATH = join(
  process.cwd(),
  "src/app/[orgSlug]/members/[memberId]/page.tsx",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf-8");
}

describe("member profile page source", () => {
  it("imports ConnectedAccountsSection", () => {
    const source = readSource();
    assert.match(
      source,
      /import.*ConnectedAccountsSection.*from.*@\/components\/members\/ConnectedAccountsSection/,
    );
  });

  it("computes isOwnProfile", () => {
    const source = readSource();
    assert.match(source, /isOwnProfile/);
  });

  it("gates connected accounts on isOwnProfile", () => {
    const source = readSource();
    assert.match(source, /isOwnProfile\s*&&/);
  });
});
