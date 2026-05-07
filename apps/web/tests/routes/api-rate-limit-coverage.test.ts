import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const API_ROOT = resolve(process.cwd(), "src/app/api");
const HTTP_METHOD_EXPORT =
  /export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
const LOCAL_IMPORT = /from\s+["'](\.[^"']+)["']/g;

const LEGACY_EXEMPTIONS: Record<string, string> = {
  "src/app/api/admin/bugs/[groupId]/status/route.ts":
    "Internal admin bug triage endpoint; existing auth/admin checks predate endpoint limiter policy.",
  "src/app/api/auth/accept-terms/route.ts":
    "Low-cost authenticated account-state mutation; grandfathered pending auth-route limiter sweep.",
  "src/app/api/blackbaud/status/route.ts":
    "Authenticated status read; grandfathered pending integrations limiter sweep.",
  "src/app/api/calendar/event-sync/route.ts":
    "Authenticated calendar sync fan-out; grandfathered pending calendar limiter sweep.",
  "src/app/api/calendar/feeds/[feedId]/sync/route.ts":
    "Authenticated calendar feed sync; grandfathered pending calendar limiter sweep.",
  "src/app/api/calendar/google/connect/route.ts":
    "Authenticated Google Calendar connect route; grandfathered pending calendar OAuth limiter sweep.",
  "src/app/api/calendar/org-feeds/[feedId]/route.ts":
    "Authenticated org feed mutation; grandfathered pending calendar limiter sweep.",
  "src/app/api/calendar/org-feeds/[feedId]/sync/route.ts":
    "Authenticated org feed sync; grandfathered pending calendar limiter sweep.",
  "src/app/api/calendar/sources/[sourceId]/route.ts":
    "Authenticated calendar source mutation; grandfathered pending calendar limiter sweep.",
  "src/app/api/calendar/sources/route.ts":
    "Authenticated calendar source read; grandfathered pending calendar limiter sweep.",
  "src/app/api/calendar/sync/route.ts":
    "Authenticated manual calendar sync; grandfathered pending calendar limiter sweep.",
  "src/app/api/calendar/target/route.ts":
    "Authenticated calendar target mutation; grandfathered pending calendar limiter sweep.",
  "src/app/api/google/calendars/route.ts":
    "Authenticated Google calendars read; grandfathered pending calendar OAuth limiter sweep.",
  "src/app/api/google/disconnect/route.ts":
    "Authenticated Google disconnect route; grandfathered pending calendar OAuth limiter sweep.",
  "src/app/api/media/albums/[albumId]/items/[mediaItemId]/route.ts":
    "Authenticated album item delete; grandfathered pending media limiter sweep.",
  "src/app/api/microsoft/calendars/route.ts":
    "Authenticated Microsoft calendars read; grandfathered pending calendar OAuth limiter sweep.",
  "src/app/api/microsoft/disconnect/route.ts":
    "Authenticated Microsoft disconnect route; grandfathered pending calendar OAuth limiter sweep.",
  "src/app/api/organizations/[organizationId]/mentorship/meetings/[meetingId]/route.ts":
    "Authenticated mentorship meeting delete; grandfathered pending mentorship limiter sweep.",
  "src/app/api/organizations/[organizationId]/mentorship/pairs/[pairId]/route.ts":
    "Authenticated mentorship pair mutation; grandfathered pending mentorship limiter sweep.",
  "src/app/api/organizations/[organizationId]/mentorship/tasks/[taskId]/route.ts":
    "Authenticated mentorship task mutation; grandfathered pending mentorship limiter sweep.",
  "src/app/api/schedules/google/calendars/route.ts":
    "Authenticated schedule Google calendars read; grandfathered pending schedule OAuth limiter sweep.",
  "src/app/api/schedules/google/connect/route.ts":
    "Authenticated schedule Google connect; grandfathered pending schedule OAuth limiter sweep.",
  "src/app/api/schedules/outlook/connect/route.ts":
    "Authenticated schedule Outlook connect; grandfathered pending schedule OAuth limiter sweep.",
  "src/app/api/user/linkedin/status/route.ts":
    "Authenticated LinkedIn status read; low-cost status endpoint pending broader read-route limiter sweep.",
};

function routeFiles(dir = API_ROOT): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...routeFiles(path));
    } else if (entry.name === "route.ts") {
      files.push(path);
    }
  }
  return files;
}

function resolveLocalImport(fromFile: string, specifier: string): string[] {
  const base = resolve(fromFile, "..", specifier);
  return [
    `${base}.ts`,
    join(base, "index.ts"),
    join(base, "route.ts"),
    join(base, "handler.ts"),
  ].filter(existsSync);
}

function sourceGraph(file: string, seen = new Set<string>(), depth = 0): string {
  if (seen.has(file) || depth > 4) return "";
  seen.add(file);

  const source = readFileSync(file, "utf8");
  let combined = source;
  for (const match of source.matchAll(LOCAL_IMPORT)) {
    for (const imported of resolveLocalImport(file, match[1])) {
      combined += `\n${sourceGraph(imported, seen, depth + 1)}`;
    }
  }
  return combined;
}

function exportedMethods(source: string): string[] {
  return [...source.matchAll(HTTP_METHOD_EXPORT)].map((match) => match[1]);
}

function hasEndpointRateLimit(source: string): boolean {
  return /\b(checkRateLimit|checkWebhookRateLimit|validateAlumniImportRequest)\b/.test(source);
}

function hasCronAuth(relativePath: string, source: string): boolean {
  return (
    relativePath.includes("/cron/") &&
    /\b(assertCronAuthorized|isAuthorizedCronRequest|CRON_SECRET|cron-auth|authorizeCron)\b/.test(
      source
    )
  );
}

function hasDevOnlyGuard(relativePath: string, source: string): boolean {
  return (
    relativePath.includes("/dev/") &&
    /NODE_ENV\s*!==\s*["']development/.test(source)
  );
}

function hasOauthStateOrAuthGuard(relativePath: string, source: string): boolean {
  return (
    /(?:auth|callback)\/route\.ts$/.test(relativePath) &&
    /\b(state|csrf|getUser|redirect|OAuthCallback|handleLinkedInOAuthCallback)\b/i.test(source)
  );
}

function isCovered(relativePath: string, source: string): boolean {
  return (
    hasEndpointRateLimit(source) ||
    hasCronAuth(relativePath, source) ||
    hasDevOnlyGuard(relativePath, source) ||
    hasOauthStateOrAuthGuard(relativePath, source)
  );
}

test("every API route method has rate limiting, delegated limiting, or an explicit exemption", () => {
  const uncovered: string[] = [];
  const staleExemptions = new Set(Object.keys(LEGACY_EXEMPTIONS));

  for (const file of routeFiles()) {
    const relativePath = relative(process.cwd(), file);
    const ownSource = readFileSync(file, "utf8");
    const methods = exportedMethods(ownSource);
    if (methods.length === 0) continue;

    const source = sourceGraph(file);
    const covered = isCovered(relativePath, source);
    if (covered) {
      staleExemptions.delete(relativePath);
      continue;
    }

    if (LEGACY_EXEMPTIONS[relativePath]) {
      staleExemptions.delete(relativePath);
      continue;
    }

    uncovered.push(`${methods.join(",")} ${relativePath}`);
  }

  assert.deepEqual(uncovered, [], "API routes missing rate-limit coverage");
  assert.deepEqual([...staleExemptions].sort(), [], "Remove stale rate-limit exemptions");
});

test("alumni import routes are recognized as helper-limited", () => {
  for (const relativePath of [
    "src/app/api/organizations/[organizationId]/alumni/import-csv/route.ts",
    "src/app/api/organizations/[organizationId]/alumni/import-linkedin/route.ts",
  ]) {
    assert.equal(
      hasEndpointRateLimit(sourceGraph(resolve(process.cwd(), relativePath))),
      true,
      `${relativePath} should be covered through validateAlumniImportRequest`
    );
  }
});
