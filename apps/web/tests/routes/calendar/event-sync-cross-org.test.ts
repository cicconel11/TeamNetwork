import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const routePath = join(repoRoot, "src", "app", "api", "calendar", "event-sync", "route.ts");
const googleLibPath = join(repoRoot, "src", "lib", "google", "calendar-sync.ts");
const microsoftLibPath = join(repoRoot, "src", "lib", "microsoft", "calendar-sync.ts");

describe("POST /api/calendar/event-sync cross-org isolation", () => {
  it("route validates UUIDs via baseSchemas", () => {
    const src = readFileSync(routePath, "utf8");
    assert.ok(src.includes("baseSchemas.uuid"), "Route must validate eventId/organizationId as UUIDs");
  });

  it("route delegates authorization to authorizeEventSync helper", () => {
    // Behavioral coverage of the helper lives in
    // tests/security/event-sync-authz.test.ts. This regression guard just
    // confirms the route still funnels through that helper rather than
    // re-implementing the (event lookup + admin/creator) check inline.
    const src = readFileSync(routePath, "utf8");
    assert.ok(
      src.includes("authorizeEventSync"),
      "Route must use authorizeEventSync helper for cross-org + admin/creator gating",
    );
  });

  it("route maps helper decision to 404/403/200 statuses", () => {
    const src = readFileSync(routePath, "utf8");
    assert.ok(src.includes("status === 404"), "Route must surface helper 404");
    assert.ok(src.includes("Not found"), "Route must use Not found message for missing/cross-org event");
    assert.ok(src.includes("Forbidden"), "Route must use Forbidden message for non-admin/non-creator");
  });

  it("route applies per-IP and per-user rate limits before sync work", () => {
    const src = readFileSync(routePath, "utf8");
    assert.ok(src.includes("checkRateLimit"), "Route must rate-limit before triggering external sync");
    assert.ok(src.includes("calendar event-sync"), "Rate-limit feature label expected");
    const idxRate = src.indexOf("checkRateLimit");
    const idxAuthz = src.indexOf("authorizeEventSync");
    assert.ok(idxRate > -1 && idxAuthz > -1 && idxRate < idxAuthz,
      "Rate limit must run before authorization to cap anonymous probes");
  });

  it("google sync library scopes event lookup by organization_id", () => {
    const src = readFileSync(googleLibPath, "utf8");
    const fn = src.match(/syncEventToUsers[\s\S]*?async function|export async function syncEventToUsers[\s\S]*?\}\s*$/);
    // Loose check: assert the org filter appears near the events query in the file.
    const block = src.match(/from\("events"\)([\s\S]*?)(maybeSingle|single)\(\)/);
    assert.ok(block, "Expected events fetch in google calendar-sync");
    assert.ok(
      block[1].includes('.eq("id", eventId)') &&
        block[1].includes('.eq("organization_id", organizationId)'),
      "Google syncEventToUsers must filter events by both id and organization_id",
    );
    assert.ok(fn, "Function present");
  });

  it("microsoft sync library scopes event lookup by organization_id", () => {
    const src = readFileSync(microsoftLibPath, "utf8");
    const block = src.match(/from\("events"\)([\s\S]*?)(maybeSingle|single)\(\)/);
    assert.ok(block, "Expected events fetch in microsoft calendar-sync");
    assert.ok(
      block[1].includes('.eq("id", eventId)') &&
        block[1].includes('.eq("organization_id", organizationId)'),
      "Outlook syncOutlookEventToUsers must filter events by both id and organization_id",
    );
  });
});
