// scripts/run-fast-tests.js
// Runs all fast tests (excludes e2e + integration) using Node's built-in test runner.
// Uses Node 22+ built-in fs.globSync — no external dependencies.
const { globSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const DISCOVERY_GLOB = "tests/**/*.test.ts";
const EXCLUDED_DIRS = ["tests/e2e/**", "tests/integration/**"];

const testFiles = globSync(DISCOVERY_GLOB, { exclude: EXCLUDED_DIRS, cwd: root })
  .map((p) => p.toString())
  .sort();

if (testFiles.length === 0) {
  console.error("❌ No test files found — glob may be misconfigured");
  process.exit(1);
}

console.log(`Running ${testFiles.length} test files...`);

execFileSync(
  process.execPath,
  ["--import", "./tests/register-ts-loader.mjs", "--test", ...testFiles],
  { stdio: "inherit", cwd: root }
);
