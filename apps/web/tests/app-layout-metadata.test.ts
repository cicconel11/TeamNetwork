import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("root layout declares explicit versioned TeamNetwork icons", () => {
  const sharedSource = readFileSync("src/lib/site-metadata.ts", "utf8");
  const source = readFileSync("src/app/layout.tsx", "utf8");

  assert.match(sharedSource, /export const SITE_URL = "https:\/\/www\.myteamnetwork\.com"/);
  assert.match(sharedSource, /export const SITE_NAME = "TeamNetwork"/);
  assert.match(sharedSource, /export const SITE_ICON_VERSION = "tn-20260325b"/);
  assert.match(sharedSource, /favicon: `\/favicon\.ico\?v=\$\{SITE_ICON_VERSION\}`/);
  assert.match(sharedSource, /icon192: `\/icon\.png\?v=\$\{SITE_ICON_VERSION\}`/);
  assert.match(sharedSource, /appleTouch: `\/apple-icon\.png\?v=\$\{SITE_ICON_VERSION\}`/);
  assert.match(source, /metadataBase:\s*new URL\(SITE_URL\)/);
  assert.match(source, /applicationName:\s*SITE_NAME/);
  assert.match(source, /title:\s*SITE_NAME/);
  assert.match(source, /description:\s*SITE_DESCRIPTION/);
  assert.match(source, /SITE_ICON_PATHS\.favicon/);
  assert.match(source, /SITE_ICON_PATHS\.icon192/);
  assert.match(source, /SITE_ICON_PATHS\.appleTouch/);
});

test("icon assets are served from public instead of app router conventions", () => {
  assert.equal(existsSync("src/app/favicon.ico"), false);
  assert.equal(existsSync("src/app/icon.png"), false);
  assert.equal(existsSync("src/app/apple-icon.png"), false);

  assert.equal(existsSync("public/favicon.ico"), true);
  assert.equal(existsSync("public/icon.png"), true);
  assert.equal(existsSync("public/apple-icon.png"), true);
});

test("app manifest declares the TeamNetwork brand icons", () => {
  const source = readFileSync("src/app/manifest.ts", "utf8");

  assert.match(source, /export default function manifest\(\): MetadataRoute\.Manifest/);
  assert.match(source, /name:\s*SITE_NAME/);
  assert.match(source, /short_name:\s*SITE_NAME/);
  assert.match(source, /description:\s*SITE_DESCRIPTION/);
  assert.match(source, /src:\s*SITE_ICON_PATHS\.favicon/);
  assert.match(source, /src:\s*SITE_ICON_PATHS\.icon192/);
  assert.match(source, /src:\s*SITE_ICON_PATHS\.appleTouch/);
});
