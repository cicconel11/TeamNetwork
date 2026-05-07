// scripts/run-ai-tests.js
// Runs the deterministic AI-focused test suite without e2e or live model calls.
const { globSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const DISCOVERY_GLOBS = [
  "tests/ai*.test.ts",
  "tests/ai/**/*.test.ts",
  "tests/routes/ai/**/*.test.ts",
];

const testFiles = Array.from(
  new Set(
    DISCOVERY_GLOBS.flatMap((pattern) =>
      globSync(pattern, { cwd: root }).map((p) => p.toString())
    )
  )
).sort();

if (testFiles.length === 0) {
  console.error("No AI test files found - glob may be misconfigured");
  process.exit(1);
}

console.log(`Running ${testFiles.length} AI test files...`);

execFileSync(
  process.execPath,
  ["--import", "./tests/register-ts-loader.mjs", "--test", ...testFiles],
  { stdio: "inherit", cwd: root }
);
