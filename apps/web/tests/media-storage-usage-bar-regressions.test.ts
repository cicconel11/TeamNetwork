import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_LOCALES } from "../src/i18n/config.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(read(relativePath)) as Record<string, unknown>;
}

function getNestedValue(record: Record<string, unknown>, keyPath: string): unknown {
  return keyPath.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object" || !(key in (value as Record<string, unknown>))) {
      return undefined;
    }

    return (value as Record<string, unknown>)[key];
  }, record);
}

test("media storage usage bar reads copy from next-intl translations", () => {
  const source = read("src/components/media/MediaStorageUsageBar.tsx");

  assert.match(
    source,
    /useTranslations\("media\.storage"\)/,
    "MediaStorageUsageBar must source its copy from media.storage translations",
  );
  assert.match(source, /tStorage\("title"\)/);
  assert.match(source, /tStorage\("usedUnlimited"/);
  assert.match(source, /tStorage\("usedOf"/);
  assert.match(source, /tStorage\("quotaExceeded"\)/);
  assert.match(source, /tStorage\("approachingLimit"\)/);
  assert.match(source, /tStorage\("ariaUsedUnlimited"/);
  assert.match(source, /tStorage\("ariaUsedOf"/);
});

test("all supported locales provide media storage usage bar translations", () => {
  const requiredKeys = [
    "media.storage.title",
    "media.storage.usedOf",
    "media.storage.usedUnlimited",
    "media.storage.quotaExceeded",
    "media.storage.approachingLimit",
    "media.storage.ariaUsedOf",
    "media.storage.ariaUsedUnlimited",
  ];

  for (const locale of SUPPORTED_LOCALES) {
    const messages = readJson(`messages/${locale}.json`);

    for (const keyPath of requiredKeys) {
      assert.notEqual(
        getNestedValue(messages, keyPath),
        undefined,
        `${locale} is missing ${keyPath}`,
      );
    }
  }
});

test("media storage usage bar reserves mobile space for the bottom bulk action bar", () => {
  const source = read("src/components/media/MediaStorageUsageBar.tsx");

  assert.match(
    source,
    /className=\{`fixed [^`]*bottom-24[^`]*sm:bottom-4[^`]*z-20[^`]*sm:z-40[^`]*`\}/,
    "MediaStorageUsageBar must shift upward and below the action bar on small screens",
  );
});
