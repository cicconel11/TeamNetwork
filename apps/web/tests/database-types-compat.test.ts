import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const databaseTypesPath = path.resolve(import.meta.dirname, "..", "src", "types", "database.ts");
const databaseTypesSource = fs.readFileSync(databaseTypesPath, "utf8");
const packageJsonPath = path.resolve(import.meta.dirname, "..", "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
  scripts?: Record<string, string>;
};

test("database.ts preserves critical compatibility aliases", () => {
  const expectedExports = [
    "Organization",
    "Alumni",
    "UserRole",
    "RsvpStatus",
    "AlumniBucket",
    "SubscriptionInterval",
  ];

  for (const exportName of expectedExports) {
    assert.match(
      databaseTypesSource,
      new RegExp(`export\\s+(type|interface)\\s+${exportName}\\b`),
      `Expected ${exportName} to remain exported from src/types/database.ts`,
    );
  }
});

test("gen:types restores compatibility aliases automatically", () => {
  assert.match(
    packageJson.scripts?.["gen:types"] ?? "",
    /append-database-compat\.js/,
    "Expected gen:types to run the database compatibility append step",
  );
});
