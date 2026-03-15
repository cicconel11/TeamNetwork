import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(process.cwd(), "src/components/ui/InlineBanner.tsx"),
  "utf-8",
);

describe("InlineBanner source", () => {
  it("renders role='alert' for accessibility", () => {
    assert.match(src, /role="alert"/);
  });

  it("renders aria-live attribute", () => {
    assert.match(src, /aria-live/);
  });

  it("supports error variant with red classes", () => {
    assert.match(src, /bg-red-50/);
    assert.match(src, /text-red-600/);
  });

  it("supports success variant with green classes", () => {
    assert.match(src, /bg-green-50/);
    assert.match(src, /text-green-700/);
  });

  it("supports warning variant with amber classes", () => {
    assert.match(src, /bg-amber-50/);
    assert.match(src, /text-amber-700/);
  });

  it("supports info variant with blue classes", () => {
    assert.match(src, /bg-blue-50/);
    assert.match(src, /text-blue-700/);
  });

  it("does not contain setTimeout (no auto-dismiss logic)", () => {
    assert.doesNotMatch(src, /setTimeout/);
  });

  it("spreads additional HTML props for data-testid support", () => {
    assert.match(src, /\.\.\.props|\.\.\.rest/);
  });
});

const barrel = readFileSync(
  join(process.cwd(), "src/components/ui/index.ts"),
  "utf-8",
);

describe("UI barrel export", () => {
  it("exports InlineBanner", () => {
    assert.match(barrel, /InlineBanner/);
  });
});
