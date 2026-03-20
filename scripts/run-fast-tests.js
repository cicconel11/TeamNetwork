// scripts/run-fast-tests.js
// Runs all fast tests (excludes e2e + integration) using Node's built-in test runner.
// Uses Node 22+ built-in fs.globSync — no external dependencies.
import { globSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..");

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
  ["--test", "--loader", "./tests/ts-loader.js", ...testFiles],
  { stdio: "inherit", cwd: root }
);
