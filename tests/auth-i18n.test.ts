import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_LOCALES } from "../src/i18n/config.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authComponentPaths = [
  "src/app/auth/login/LoginClient.tsx",
  "src/app/auth/signup/SignupClient.tsx",
  "src/app/auth/forgot-password/ForgotPasswordClient.tsx",
];

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

function extractTranslationKeys(source: string) {
  const keys = new Set<string>();

  for (const match of source.matchAll(/(?:^|[^A-Za-z0-9_])t\("([^"]+)"\)/gm)) {
    if (match[1]) {
      keys.add(match[1]);
    }
  }

  return [...keys].sort();
}

test("auth locale files contain every translation key used by the auth clients", () => {
  const requiredKeys = new Set<string>();

  for (const relativePath of authComponentPaths) {
    const source = readFileSync(path.join(repoRoot, relativePath), "utf8");

    for (const key of extractTranslationKeys(source)) {
      requiredKeys.add(key);
    }
  }

  for (const locale of SUPPORTED_LOCALES) {
    const messages = readJson(`messages/${locale}.json`);

    for (const key of requiredKeys) {
      assert.notEqual(
        getNestedValue(messages, `auth.${key}`),
        undefined,
        `${locale} is missing auth.${key}`,
      );
    }
  }
});
