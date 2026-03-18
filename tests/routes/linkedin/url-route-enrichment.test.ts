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
  "app",
  "api",
  "user",
  "linkedin",
  "url",
  "route.ts",
);

const routeSource = fs.readFileSync(routePath, "utf8");

test("PATCH /api/user/linkedin/url imports runProxycurlEnrichment", () => {
  assert.match(
    routeSource,
    /import\s*\{[^}]*runProxycurlEnrichment[^}]*\}\s*from\s*["']@\/lib\/linkedin\/oauth["']/,
    "Expected route to import runProxycurlEnrichment from @/lib/linkedin/oauth",
  );
});

test("PATCH /api/user/linkedin/url calls enrichment when a URL is provided", () => {
  assert.match(
    routeSource,
    /if\s*\(parsedBody\.linkedinUrl\)\s*\{[^}]*runProxycurlEnrichment/s,
    "Expected route to call runProxycurlEnrichment gated on parsedBody.linkedinUrl",
  );
});

test("PATCH /api/user/linkedin/url calls enrichment after save succeeds", () => {
  const saveIdx = routeSource.indexOf("saveLinkedInUrlForUser");
  const enrichIdx = routeSource.indexOf("runProxycurlEnrichment");
  assert.ok(saveIdx > 0, "Expected saveLinkedInUrlForUser call in route");
  assert.ok(enrichIdx > 0, "Expected runProxycurlEnrichment call in route");
  assert.ok(
    enrichIdx > saveIdx,
    "Expected runProxycurlEnrichment to be called after saveLinkedInUrlForUser",
  );
});
