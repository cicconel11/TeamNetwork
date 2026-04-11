import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_LOCALES } from "../src/i18n/config.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const donationsPagePath = path.join(repoRoot, "src/app/[orgSlug]/donations/page.tsx");

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8")) as Record<string, unknown>;
}

function getNestedValue(record: Record<string, unknown>, keyPath: string): unknown {
  return keyPath.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object" || !(key in (value as Record<string, unknown>))) {
      return undefined;
    }

    return (value as Record<string, unknown>)[key];
  }, record);
}

function extractTranslationKeys(source: string, translatorName: string) {
  const pattern = new RegExp(`${translatorName}\\("([^"]+)"`, "g");
  const keys = new Set<string>();

  for (const match of source.matchAll(pattern)) {
    if (match[1]) {
      keys.add(match[1]);
    }
  }

  return [...keys].sort();
}

test("donations page only references translation keys that exist in every locale file", () => {
  const source = readFileSync(donationsPagePath, "utf8");
  const donationKeys = extractTranslationKeys(source, "tDonations");
  const commonKeys = extractTranslationKeys(source, "tCommon");

  for (const locale of SUPPORTED_LOCALES) {
    const messages = readJson(`messages/${locale}.json`);

    for (const key of donationKeys) {
      assert.notEqual(
        getNestedValue(messages, `donations.${key}`),
        undefined,
        `${locale} is missing donations.${key}`,
      );
    }

    for (const key of commonKeys) {
      assert.notEqual(
        getNestedValue(messages, `common.${key}`),
        undefined,
        `${locale} is missing common.${key}`,
      );
    }
  }
});

test("donations page no longer references the removed donation translation keys", () => {
  const source = readFileSync(donationsPagePath, "utf8");

  assert.doesNotMatch(source, /tDonations\("fundsSettleViaStripe"/);
  assert.doesNotMatch(source, /tDonations\("willBeGrouped"/);
  assert.doesNotMatch(source, /tDonations\("donationsWillAppear"/);
  assert.doesNotMatch(source, /tDonations\("noDonationsYet"/);
});
