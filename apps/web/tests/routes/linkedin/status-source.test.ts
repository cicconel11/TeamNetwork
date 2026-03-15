import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const routePath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "src",
  "lib",
  "linkedin",
  "settings.ts",
);

const routeSource = fs.readFileSync(routePath, "utf8");

test("linkedin status helper filters soft-deleted memberships", () => {
  assert.match(
    routeSource,
    /\.is\("deleted_at", null\)/,
    "Expected LinkedIn membership lookups to filter deleted_at = null",
  );
  assert.match(routeSource, /getLatestLinkedInUrl\(supabase, "members", userId\)/);
  assert.match(routeSource, /getLatestLinkedInUrl\(supabase, "alumni", userId\)/);
  assert.match(routeSource, /getLatestLinkedInUrl\(supabase, "parents", userId\)/);
});

test("linkedin status helper makes the winning linkedin_url deterministic", () => {
  assert.match(
    routeSource,
    /\.order\("updated_at",\s*\{\s*ascending:\s*false\s*\}\)|\.order\("created_at",\s*\{\s*ascending:\s*false\s*\}\)/,
    "Expected linkedin status queries to order results before limit(1)",
  );
});
