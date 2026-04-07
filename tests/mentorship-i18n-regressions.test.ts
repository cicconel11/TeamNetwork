import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_LOCALES } from "../src/i18n/config.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8")) as Record<
    string,
    unknown
  >;
}

function getNestedValue(record: Record<string, unknown>, keyPath: string): unknown {
  return keyPath.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object" || !(key in (value as Record<string, unknown>))) {
      return undefined;
    }

    return (value as Record<string, unknown>)[key];
  }, record);
}

test("all supported locales provide the mentorship translations used by the revamp", () => {
  const requiredKeys = [
    "mentorship.editorialStrapline",
    "mentorship.mentorSelectLabel",
    "mentorship.menteeSelectLabel",
    "mentorship.selectMentor",
    "mentorship.selectMentee",
    "mentorship.noMenteeAssignedYet",
    "mentorship.openPairMenu",
    "mentorship.statusActive",
    "mentorship.statusPaused",
    "mentorship.statusCompleted",
    "mentorship.loggedBy",
    "mentorship.progressMetric",
    "mentorship.loadingControls",
    "mentorship.signInManagePair",
    "mentorship.signInManageAvailability",
  ];

  for (const locale of SUPPORTED_LOCALES) {
    const messages = readJson(`messages/${locale}.json`);

    for (const keyPath of requiredKeys) {
      assert.notEqual(
        getNestedValue(messages, keyPath),
        undefined,
        `${locale} is missing ${keyPath}`
      );
    }
  }
});

test("revamped mentorship components no longer hard-code reviewed English copy", () => {
  const stripSource = readFileSync(
    path.join(repoRoot, "src/components/mentorship/MentorshipContextStrip.tsx"),
    "utf8"
  );
  const pairCardSource = readFileSync(
    path.join(repoRoot, "src/components/mentorship/MentorshipPairCard.tsx"),
    "utf8"
  );

  assert.doesNotMatch(stripSource, /Loading your mentorship controls\.\.\./);
  assert.doesNotMatch(stripSource, /No mentee assigned yet/);
  assert.doesNotMatch(stripSource, /Select mentor|Select mentee/);

  assert.doesNotMatch(pairCardSource, /Open pair menu/);
  assert.doesNotMatch(pairCardSource, /\bby \{/);
  assert.doesNotMatch(pairCardSource, /Progress: \{/);
});
