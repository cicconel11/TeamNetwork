import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_LOCALES } from "../src/i18n/config.ts";
import {
  CUSTOMIZATION_TIMEZONE_OPTION_KEYS,
  getCustomizationTimezoneOptions,
} from "../src/lib/i18n/customization-timezones.ts";
import { EVENT_TYPE_OPTIONS } from "../src/lib/events/event-type-options.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("customization timezone options are built from translation keys", () => {
  const options = getCustomizationTimezoneOptions((key) => `translated:${key}`);

  assert.equal(options[0]?.label, "translated:timezone.options.newYork");
  assert.equal(options.at(-1)?.label, "translated:timezone.options.utc");
});

test("customization page no longer hard-codes English timezone labels", () => {
  const source = readFileSync(
    path.join(repoRoot, "src/app/[orgSlug]/customization/page.tsx"),
    "utf8",
  );

  assert.match(source, /getCustomizationTimezoneOptions/);
  assert.doesNotMatch(source, /Eastern Time \(US\)|Pacific Time \(US\)|Arizona \(no DST\)/);
});

test("all supported locales provide the customization translations used by the page", () => {
  const englishMessages = readJson("messages/en.json");
  const requiredKeys = [
    "customization.fallbackOrgName",
    "customization.timezone.title",
    "customization.timezone.description",
    "customization.timezone.label",
    "customization.googleCalendar.title",
    "customization.integrations.title",
    "customization.permissions.feedTitle",
    "customization.linkedin.title",
    "customization.errors.adminOnlyLanguage",
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

    for (const option of CUSTOMIZATION_TIMEZONE_OPTION_KEYS) {
      assert.notEqual(
        getNestedValue(messages, `customization.timezone.options.${option.key}`),
        undefined,
        `${locale} is missing customization.timezone.options.${option.key}`,
      );
    }

    if (locale !== "en") {
      assert.notEqual(
        getNestedValue(messages, "customization.timezone.description"),
        getNestedValue(englishMessages, "customization.timezone.description"),
        `${locale} is still falling back to English for customization.timezone.description`,
      );
    }
  }
});

test("all supported locales provide event type translations for calendar forms", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const messages = readJson(`messages/${locale}.json`);

    for (const option of EVENT_TYPE_OPTIONS) {
      assert.notEqual(
        getNestedValue(messages, `events.${option.value}`),
        undefined,
        `${locale} is missing events.${option.value}`,
      );
    }
  }
});
