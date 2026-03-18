import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const oidcSyncPath = path.resolve(
  import.meta.dirname,
  "..",
  "src",
  "lib",
  "linkedin",
  "oidc-sync.ts",
);

const oidcSource = fs.readFileSync(oidcSyncPath, "utf8");

test("select includes status alongside linkedin_data", () => {
  assert.match(
    oidcSource,
    /\.select\(["']linkedin_data,\s*status["']\)/,
    "expected select to include both linkedin_data and status",
  );
});

test("enriched_only status triggers upgrade path", () => {
  assert.match(
    oidcSource,
    /existing\.status\s*===\s*["']enriched_only["']/,
    "expected check for enriched_only status",
  );
});

test("upgrade path preserves enrichment data via spread merge", () => {
  // The merged data should spread existing.linkedin_data first, then add source
  const upgradeBlock = oidcSource.slice(
    oidcSource.indexOf("enriched_only"),
    oidcSource.indexOf("Row exists"),
  );
  assert.match(
    upgradeBlock,
    /\.\.\.\(existing\.linkedin_data\s*\|\|\s*\{\}\)/,
    "expected spread of existing linkedin_data to preserve enrichment",
  );
  assert.match(
    upgradeBlock,
    /source:\s*LINKEDIN_OIDC_SOURCE/,
    "expected source to be set to LINKEDIN_OIDC_SOURCE in merged data",
  );
});

test("upgrade path sets status to connected", () => {
  const upgradeBlock = oidcSource.slice(
    oidcSource.indexOf("enriched_only"),
    oidcSource.indexOf("Row exists"),
  );
  assert.match(
    upgradeBlock,
    /status:\s*["']connected["']/,
    "expected status to be updated to 'connected' on upgrade",
  );
});

test("upgrade path updates the row (not insert)", () => {
  const upgradeBlock = oidcSource.slice(
    oidcSource.indexOf("enriched_only"),
    oidcSource.indexOf("Row exists"),
  );
  assert.match(
    upgradeBlock,
    /\.update\(/,
    "expected .update() call in the enriched_only upgrade path",
  );
});

test("upgrade path sets OIDC sentinel token to prevent cron batch enrichment", () => {
  const upgradeBlock = oidcSource.slice(
    oidcSource.indexOf("enriched_only"),
    oidcSource.indexOf("Row exists"),
  );
  assert.match(
    upgradeBlock,
    /access_token_encrypted:\s*LINKEDIN_OIDC_TOKEN_SENTINEL/,
    "expected access_token_encrypted to be set to LINKEDIN_OIDC_TOKEN_SENTINEL in upgrade path",
  );
  assert.match(
    upgradeBlock,
    /token_expires_at:/,
    "expected token_expires_at to be set in upgrade path",
  );
});
