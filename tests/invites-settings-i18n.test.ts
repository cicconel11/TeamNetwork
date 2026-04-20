import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_LOCALES } from "../src/i18n/config.ts";

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

test("invites settings page uses existing translated keys and common fallback text", () => {
  const source = readFileSync(
    path.join(repoRoot, "src/app/[orgSlug]/settings/invites/page.tsx"),
    "utf8",
  );

  assert.match(source, /tSettings\("bulkImport"\)/);
  assert.match(source, /tSettings\("requireApprovalDesc"\)/);
  assert.match(source, /tCommon\("noPendingApprovals"\)/);
  assert.match(source, /tSettings\("reviewPending"\)/);
  assert.doesNotMatch(source, /tSettings\("requireApprovalDescription"\)/);
  assert.doesNotMatch(source, /tSettings\("reviewPendingMembers"\)/);
});

test("all supported locales provide invites settings labels without English stopgaps", () => {
  const englishMessages = readJson("messages/en.json");
  const englishCount = getNestedValue(englishMessages, "settings.pendingApprovalsCount");
  const englishBulkImport = getNestedValue(englishMessages, "settings.bulkImport");

  for (const locale of SUPPORTED_LOCALES) {
    const messages = readJson(`messages/${locale}.json`);
    const pendingCount = getNestedValue(messages, "settings.pendingApprovalsCount");
    const bulkImport = getNestedValue(messages, "settings.bulkImport");

    assert.notEqual(
      pendingCount,
      undefined,
      `${locale} is missing settings.pendingApprovalsCount`,
    );
    assert.notEqual(
      bulkImport,
      undefined,
      `${locale} is missing settings.bulkImport`,
    );

    if (locale !== "en") {
      assert.notEqual(
        pendingCount,
        englishCount,
        `${locale} is still falling back to English for settings.pendingApprovalsCount`,
      );
      assert.notEqual(
        bulkImport,
        englishBulkImport,
        `${locale} is still falling back to English for settings.bulkImport`,
      );
    }

    assert.equal(
      getNestedValue(messages, "settings.requireApprovalDescription"),
      undefined,
      `${locale} should reuse settings.requireApprovalDesc instead of a duplicate stopgap key`,
    );
    assert.equal(
      getNestedValue(messages, "settings.reviewPendingMembers"),
      undefined,
      `${locale} should reuse settings.reviewPending instead of a duplicate stopgap key`,
    );
    assert.equal(
      getNestedValue(messages, "settings.noPendingApprovals"),
      undefined,
      `${locale} should reuse common.noPendingApprovals instead of a duplicate stopgap key`,
    );
  }
});
