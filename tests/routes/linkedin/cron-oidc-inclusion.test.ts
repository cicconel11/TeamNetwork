import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const routePath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "src",
  "app",
  "api",
  "cron",
  "linkedin-enrich",
  "route.ts",
);

const routeSource = fs.readFileSync(routePath, "utf8");

test("cron route does NOT filter out OIDC sentinel tokens", () => {
  assert.ok(
    !routeSource.includes("LINKEDIN_OIDC_TOKEN_SENTINEL"),
    "should not reference LINKEDIN_OIDC_TOKEN_SENTINEL — OIDC users are eligible for enrichment",
  );
});

test("cron route does NOT import LINKEDIN_OIDC_TOKEN_SENTINEL", () => {
  assert.ok(
    !routeSource.includes("LINKEDIN_OIDC_TOKEN_SENTINEL"),
    "should not import the OIDC sentinel constant",
  );
});

test("cron route includes enriched_only status in query filter", () => {
  assert.match(
    routeSource,
    /\.in\(\s*"status"\s*,\s*\[\s*"connected"\s*,\s*"enriched_only"\s*\]/,
    'expected .in("status", ["connected", "enriched_only"]) filter',
  );
});

test("cron route does NOT use .eq status filter (uses .in instead)", () => {
  // Should not have .eq("status", "connected") — that excludes enriched_only
  assert.ok(
    !routeSource.includes('.eq("status", "connected")'),
    'should not use .eq("status", "connected") — must use .in() to include enriched_only',
  );
});
