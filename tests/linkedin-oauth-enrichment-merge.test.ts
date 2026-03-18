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

test("storeLinkedInConnection reads existing row before upsert", () => {
  // Extract the storeLinkedInConnection function body
  const fnStart = oauthSource.indexOf("export async function storeLinkedInConnection");
  assert.ok(fnStart > -1, "expected storeLinkedInConnection function");

  const fnBody = oauthSource.slice(fnStart);

  // Should read existing linkedin_data before the upsert
  const selectIdx = fnBody.indexOf('.select("linkedin_data")');
  const upsertIdx = fnBody.indexOf(".upsert(");
  assert.ok(selectIdx > -1, "expected select of existing linkedin_data");
  assert.ok(upsertIdx > -1, "expected upsert call");
  assert.ok(
    selectIdx < upsertIdx,
    "existing row read must come before upsert",
  );
});

test("storeLinkedInConnection merges enrichment data from existing row", () => {
  const fnStart = oauthSource.indexOf("export async function storeLinkedInConnection");
  const fnBody = oauthSource.slice(fnStart);

  // Should check for existing enrichment and spread existing data
  assert.match(
    fnBody,
    /existing\?\.linkedin_data\?\.enrichment/,
    "expected check for existing enrichment data",
  );
  assert.match(
    fnBody,
    /\.\.\.existing\.linkedin_data/,
    "expected spread of existing linkedin_data to preserve enrichment",
  );
});

test("storeLinkedInConnection uses mergedLinkedinData in upsert", () => {
  const fnStart = oauthSource.indexOf("export async function storeLinkedInConnection");
  const fnBody = oauthSource.slice(fnStart);

  // The upsert should use mergedLinkedinData, not an inline object
  assert.match(
    fnBody,
    /linkedin_data:\s*mergedLinkedinData/,
    "expected upsert to use mergedLinkedinData variable",
  );
});

test("storeLinkedInConnection: new OAuth fields override old source/email_verified", () => {
  const fnStart = oauthSource.indexOf("export async function storeLinkedInConnection");
  const fnBody = oauthSource.slice(fnStart);

  // The merge pattern should spread existing FIRST, then new fields override
  // i.e. { ...existing.linkedin_data, ...mergedLinkedinData } or equivalent
  const mergeBlock = fnBody.slice(
    fnBody.indexOf("if (existing?.linkedin_data?.enrichment)"),
  );
  assert.ok(mergeBlock.length > 0, "expected merge block");

  // New source/email_verified fields should be in mergedLinkedinData which
  // spreads AFTER existing, ensuring they override
  const spreadExisting = mergeBlock.indexOf("...existing.linkedin_data");
  const spreadNew = mergeBlock.indexOf("...mergedLinkedinData");
  assert.ok(spreadExisting > -1, "expected spread of existing linkedin_data");
  assert.ok(spreadNew > -1, "expected spread of mergedLinkedinData (new fields)");
  assert.ok(
    spreadExisting < spreadNew,
    "existing data should be spread first so new OAuth fields override",
  );
});
