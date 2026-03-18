import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const oauthPath = path.resolve(
  import.meta.dirname,
  "..",
  "src",
  "lib",
  "linkedin",
  "oauth.ts",
);

const oauthSource = fs.readFileSync(oauthPath, "utf8");

test("syncLinkedInProfile reads existing linkedin_data before the merge update", () => {
  const fnStart = oauthSource.indexOf("export async function syncLinkedInProfile");
  assert.ok(fnStart > -1, "expected syncLinkedInProfile function");

  const fnBody = oauthSource.slice(fnStart);

  // Should select existing linkedin_data before the mergedLinkedinData usage
  const selectIdx = fnBody.indexOf('.select("linkedin_data")');
  const mergedIdx = fnBody.indexOf("mergedLinkedinData");
  assert.ok(selectIdx > -1, "expected select of existing linkedin_data");
  assert.ok(mergedIdx > -1, "expected mergedLinkedinData variable");
  assert.ok(
    selectIdx < mergedIdx,
    "existing row read must come before mergedLinkedinData construction",
  );
});

test("syncLinkedInProfile merges existing linkedin_data with new fields", () => {
  const fnStart = oauthSource.indexOf("export async function syncLinkedInProfile");
  const fnBody = oauthSource.slice(fnStart);

  // Should spread existing data to preserve enrichment
  assert.match(
    fnBody,
    /existingConn\?\.linkedin_data/,
    "expected reference to existing linkedin_data",
  );
  assert.match(
    fnBody,
    /mergedLinkedinData/,
    "expected mergedLinkedinData variable",
  );
});

test("syncLinkedInProfile uses mergedLinkedinData in update call", () => {
  const fnStart = oauthSource.indexOf("export async function syncLinkedInProfile");
  const fnBody = oauthSource.slice(fnStart);

  // The update should use mergedLinkedinData, not an inline { email_verified } object
  assert.match(
    fnBody,
    /linkedin_data:\s*mergedLinkedinData/,
    "expected update to use mergedLinkedinData variable",
  );

  // Should NOT have the old inline overwrite pattern
  const updateStart = fnBody.indexOf("updateLinkedInConnection");
  const updateBlock = fnBody.slice(updateStart, updateStart + 500);
  assert.ok(
    !updateBlock.includes("linkedin_data: { email_verified:"),
    "should not have inline linkedin_data overwrite in update call",
  );
});
