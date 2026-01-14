import assert from "node:assert/strict";
import test from "node:test";
import { generateQRSvg } from "../src/lib/qr-utils";

test("valid URL generates SVG string", async () => {
  const result = await generateQRSvg("https://example.com");
  assert.equal(result.error, null);
  assert.ok(result.svg);
  assert.ok(result.svg.startsWith("<svg"));
  assert.ok(result.svg.includes("viewBox"));
});

test("SVG contains correct width/height for various sizes", async () => {
  for (const size of [128, 180, 192, 256]) {
    const result = await generateQRSvg("https://example.com", size);
    assert.equal(result.error, null);
    assert.ok(result.svg);
    assert.ok(
      result.svg.includes(`width="${size}"`),
      `Expected width="${size}" in SVG for size ${size}`
    );
    assert.ok(
      result.svg.includes(`height="${size}"`),
      `Expected height="${size}" in SVG for size ${size}`
    );
  }
});

test("SVG contains black and white color values", async () => {
  const result = await generateQRSvg("https://example.com");
  assert.equal(result.error, null);
  assert.ok(result.svg);
  assert.ok(result.svg.includes("#000000"), "Expected dark color #000000");
  assert.ok(result.svg.includes("#ffffff"), "Expected light color #ffffff");
});

test("empty string returns error", async () => {
  const result = await generateQRSvg("");
  assert.equal(result.svg, null);
  assert.equal(result.error, "No URL provided");
});

test("whitespace-only string returns error", async () => {
  const result = await generateQRSvg("   ");
  assert.equal(result.svg, null);
  assert.equal(result.error, "No URL provided");
});

test("same URL generates identical SVG across calls", async () => {
  const result1 = await generateQRSvg("https://example.com/test");
  const result2 = await generateQRSvg("https://example.com/test");
  assert.equal(result1.error, null);
  assert.equal(result2.error, null);
  assert.equal(result1.svg, result2.svg);
});

test("URL with special characters generates valid SVG", async () => {
  const url = "https://example.com/path?foo=bar&baz=qux#section";
  const result = await generateQRSvg(url);
  assert.equal(result.error, null);
  assert.ok(result.svg);
  assert.ok(result.svg.startsWith("<svg"));
});

test("long URL succeeds without error", async () => {
  const url = "https://example.com/" + "a".repeat(500);
  const result = await generateQRSvg(url);
  assert.equal(result.error, null);
  assert.ok(result.svg);
  assert.ok(result.svg.startsWith("<svg"));
});
