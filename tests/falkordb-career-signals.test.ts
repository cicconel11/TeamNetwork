import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeIndustry,
  normalizeCareerText,
  parseMemberCareerString,
} from "../src/lib/falkordb/career-signals.ts";

test("canonicalizeIndustry maps raw alumni industries into canonical buckets", () => {
  assert.equal(canonicalizeIndustry("Banking"), "Finance");
  assert.equal(canonicalizeIndustry("Private Equity"), "Finance");
  assert.equal(canonicalizeIndustry("Media & Entertainment"), "Media");
  assert.equal(canonicalizeIndustry("Technology"), "Technology");
  assert.equal(canonicalizeIndustry("Unknown"), null);
});

test("parseMemberCareerString extracts employer from parenthetical role strings", () => {
  assert.deepEqual(parseMemberCareerString("Citadel (summer analyst)"), {
    employer: "Citadel",
    canonicalIndustry: "Finance",
  });
  assert.deepEqual(parseMemberCareerString("Microsoft (SWE intern)"), {
    employer: "Microsoft",
    canonicalIndustry: "Technology",
  });
});

test("parseMemberCareerString extracts employer from dash-separated role strings", () => {
  assert.deepEqual(parseMemberCareerString("Penn Medicine — clinical research assistant"), {
    employer: "Penn Medicine",
    canonicalIndustry: "Healthcare",
  });
  assert.deepEqual(parseMemberCareerString("Penn Daily Pennsylvanian - staff writer"), {
    employer: "Penn Daily Pennsylvanian",
    canonicalIndustry: "Media",
  });
});

test("parseMemberCareerString preserves unknown employers without inventing industry", () => {
  assert.deepEqual(parseMemberCareerString("Stealth Startup (founding intern)"), {
    employer: "Stealth Startup",
    canonicalIndustry: null,
  });
});

test("normalizeCareerText normalizes punctuation and spacing for exact matching", () => {
  assert.equal(normalizeCareerText("  Bain & Company  "), "bain and company");
  assert.equal(normalizeCareerText("Penn Medicine — clinical research assistant"), "penn medicine clinical research assistant");
});
