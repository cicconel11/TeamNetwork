import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..");
const routePath = join(repoRoot, "src", "app", "api", "telemetry", "error", "route.ts");
const schemaPath = join(repoRoot, "src", "lib", "schemas", "telemetry.ts");

describe("POST /api/telemetry/error trusts session, not body", () => {
  it("derives user_id from supabase.auth.getUser, not the request body", () => {
    const src = readFileSync(routePath, "utf8");
    assert.ok(
      src.includes("supabaseAuth.auth.getUser()"),
      "Route must call supabase auth.getUser() to derive trusted user id",
    );
    assert.ok(
      /const\s+trustedUserId\s*=/.test(src),
      "Route must compute a trustedUserId",
    );
    assert.ok(
      /const\s+user_id\s*=\s*trustedUserId/.test(src),
      "Route must assign user_id from trustedUserId, not from body",
    );
  });

  it("does not use body.user_id outside of comments", () => {
    const src = readFileSync(routePath, "utf8");
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.ok(
      !/body\.user_id/.test(stripped),
      "Route must not reference body.user_id in code (forged values are ignored)",
    );
  });

  it("schema documents user_id as accepted-but-ignored for back compat", () => {
    const src = readFileSync(schemaPath, "utf8");
    assert.ok(
      src.includes("accepted for backwards compatibility, ignored server-side"),
      "telemetry schema should comment that user_id is ignored server-side",
    );
  });
});
