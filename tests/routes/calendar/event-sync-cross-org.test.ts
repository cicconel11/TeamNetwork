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

  it("route fetches event filtered by both id and organization_id", () => {
    const src = readFileSync(routePath, "utf8");
    const block = src.match(/from\("events"\)([\s\S]*?)maybeSingle\(\)/);
    assert.ok(block, "Expected events fetch block in route");
    assert.ok(block[1].includes('.eq("id", eventId)'), "Route must filter by id");
    assert.ok(
      block[1].includes('.eq("organization_id", organizationId)'),
      "Route must filter by organization_id (cross-org isolation)",
    );
  });

  it("route returns 404 when event is missing or in another org", () => {
    const src = readFileSync(routePath, "utf8");
    assert.ok(src.includes('status: 404'), "Route must respond with 404 when event missing");
    assert.ok(src.includes("Not found"), "Route must use Not found error for missing event");
  });

  it("route requires active admin OR event creator", () => {
    const src = readFileSync(routePath, "utf8");
    assert.ok(
      src.includes("requireActiveOrgAdmin"),
      "Route must use requireActiveOrgAdmin helper",
    );
    assert.ok(
      src.includes("event.created_by_user_id === user.id"),
      "Route must allow the event creator as a fallback",
    );
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
