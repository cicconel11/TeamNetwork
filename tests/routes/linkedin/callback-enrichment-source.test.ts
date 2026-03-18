import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const callbackPath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "src",
  "lib",
  "linkedin",
  "callback.ts",
);

const callbackSource = fs.readFileSync(callbackPath, "utf8");

test("callback imports runProxycurlEnrichment and getLinkedInUrlForUser", () => {
  assert.match(
    callbackSource,
    /runProxycurlEnrichment/,
    "expected callback to import runProxycurlEnrichment",
  );
  assert.match(
    callbackSource,
    /getLinkedInUrlForUser/,
    "expected callback to import getLinkedInUrlForUser",
  );
});

test("enrichment call comes after syncLinkedInProfileFields", () => {
  const syncIdx = callbackSource.indexOf("syncLinkedInProfileFields");
  const enrichIdx = callbackSource.indexOf("runProxycurlEnrichment");
  assert.ok(syncIdx > -1, "syncLinkedInProfileFields should be present");
  assert.ok(enrichIdx > -1, "runProxycurlEnrichment should be present");
  assert.ok(
    enrichIdx > syncIdx,
    "runProxycurlEnrichment must be called after syncLinkedInProfileFields",
  );
});

test("enrichment call does NOT pass skipRateLimit (relies on natural null check)", () => {
  // First-ever connections have last_enriched_at = null, so the rate-limit
  // check naturally allows enrichment. Reconnects within 30 days are blocked.
  assert.match(
    callbackSource,
    /runProxycurlEnrichment\(serviceClient,\s*user\.id,\s*enrichUrl\)/,
    "expected enrichment call without skipRateLimit flag",
  );
  assert.doesNotMatch(
    callbackSource,
    /runProxycurlEnrichment\(serviceClient,\s*user\.id,\s*enrichUrl,\s*true\)/,
    "skipRateLimit=true should not be passed — cooldown bypass is no longer needed",
  );
});

test("enrichment failure does not block the success redirect", () => {
  // The enrichment block should be wrapped in its own try/catch
  const enrichBlock = callbackSource.slice(
    callbackSource.indexOf("Best-effort enrichment"),
  );
  const catchIdx = enrichBlock.indexOf("catch (enrichErr)");
  const redirectIdx = enrichBlock.indexOf("buildSuccessRedirect");
  assert.ok(catchIdx > -1, "expected a dedicated catch for enrichment errors");
  assert.ok(redirectIdx > -1, "expected success redirect after enrichment block");
  assert.ok(
    redirectIdx > catchIdx,
    "success redirect must come after the enrichment catch block",
  );
});
