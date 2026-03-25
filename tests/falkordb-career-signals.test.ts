import test from "node:test";
import assert from "node:assert/strict";
import {
  areAdjacentRoleFamilies,
  canonicalizeIndustry,
  canonicalizeRoleFamily,
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
    roleFragment: "summer analyst",
    canonicalIndustry: "Finance",
    roleFamily: "Finance",
  });
  assert.deepEqual(parseMemberCareerString("Microsoft (SWE intern)"), {
    employer: "Microsoft",
    roleFragment: "SWE intern",
    canonicalIndustry: "Technology",
    roleFamily: "Engineering",
  });
});

test("parseMemberCareerString extracts employer from dash-separated role strings", () => {
  assert.deepEqual(parseMemberCareerString("Penn Medicine — clinical research assistant"), {
    employer: "Penn Medicine",
    roleFragment: "clinical research assistant",
    canonicalIndustry: "Healthcare",
    roleFamily: "Healthcare",
  });
  assert.deepEqual(parseMemberCareerString("Penn Daily Pennsylvanian - staff writer"), {
    employer: "Penn Daily Pennsylvanian",
    roleFragment: "staff writer",
    canonicalIndustry: "Media",
    roleFamily: "Media",
  });
});

test("parseMemberCareerString preserves unknown employers without inventing industry", () => {
  assert.deepEqual(parseMemberCareerString("Stealth Startup (founding intern)"), {
    employer: "Stealth Startup",
    roleFragment: "founding intern",
    canonicalIndustry: null,
    roleFamily: null,
  });
});

test("canonicalizeRoleFamily uses employer fallback only for clearly mapped generic titles", () => {
  assert.equal(canonicalizeRoleFamily("summer analyst", "Citadel", "Finance"), "Finance");
  assert.equal(canonicalizeRoleFamily("campus tour guide", "Penn Admissions", "Education"), "Education");
});

test("canonicalizeRoleFamily leaves ambiguous generic titles unclassified", () => {
  assert.equal(canonicalizeRoleFamily("founding intern", "Stealth Startup", null), null);
  assert.equal(canonicalizeRoleFamily("associate", "Unknown Company", null), null);
});

test("canonicalizeRoleFamily does not over-match generic analyst titles to Finance", () => {
  assert.equal(canonicalizeRoleFamily("data analyst", "Acme", null), "Data");
  assert.equal(canonicalizeRoleFamily("research analyst", "Acme", null), "Research");
  assert.equal(canonicalizeRoleFamily("operations analyst", "Acme", null), "Operations");
  assert.equal(canonicalizeRoleFamily("policy analyst", "Acme", null), null);
  assert.equal(canonicalizeRoleFamily("financial analyst", "Acme", null), "Finance");
  assert.equal(canonicalizeRoleFamily("investment banking analyst", "Acme", null), "Finance");
});

test("role family adjacency is available for candidate expansion only", () => {
  assert.equal(areAdjacentRoleFamilies("Engineering", "Data"), true);
  assert.equal(areAdjacentRoleFamilies("Finance", "Consulting"), true);
  assert.equal(areAdjacentRoleFamilies("Engineering", "Finance"), false);
});

test("normalizeCareerText normalizes punctuation and spacing for exact matching", () => {
  assert.equal(normalizeCareerText("  Bain & Company  "), "bain and company");
  assert.equal(normalizeCareerText("Penn Medicine — clinical research assistant"), "penn medicine clinical research assistant");
});
