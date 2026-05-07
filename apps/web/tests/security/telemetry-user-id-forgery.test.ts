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
  it("derives user_id from the trusted-user helper, not the request body", () => {
    const src = readFileSync(routePath, "utf8");
    // The auth.getUser() call lives inside resolveTrustedUserId. Verify the
    // route imports + invokes that helper rather than re-inlining the call.
    assert.ok(
      /from\s+"@\/lib\/telemetry\/trusted-user"/.test(src),
      "Route must import resolveTrustedUserId from the trusted-user helper",
    );
    assert.ok(
      /const\s+trustedUserId\s*=\s*await\s+resolveTrustedUserId\s*\(/.test(src),
      "Route must compute trustedUserId via resolveTrustedUserId(...)",
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
