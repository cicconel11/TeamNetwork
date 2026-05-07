import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "path";

/**
 * Source-level assertions that IP addresses are hashed before storage
 * in audit logs, and that the salt fallback produces a warning.
 */
describe("Security Event Persistence", () => {
  const enterpriseAuditSource = readFileSync(
    join(process.cwd(), "src/lib/audit/enterprise-audit.ts"),
    "utf-8"
  );

  const devAdminSource = readFileSync(
    join(process.cwd(), "src/lib/auth/dev-admin.ts"),
    "utf-8"
  );

  const auditLogSource = readFileSync(
    join(process.cwd(), "src/lib/compliance/audit-log.ts"),
    "utf-8"
  );

  it("should use hashIp in enterprise-audit before storing IP", () => {
    assert.ok(
      enterpriseAuditSource.includes("hashIp"),
      "enterprise-audit.ts must import and use hashIp to hash IPs before storage"
    );
    assert.ok(
      enterpriseAuditSource.includes("hashIp(entry.ipAddress)"),
      "enterprise-audit.ts must call hashIp on the IP address value"
    );
  });

  it("should use hashIp in dev-admin before storing IP", () => {
    assert.ok(
      devAdminSource.includes("hashIp"),
      "dev-admin.ts must import and use hashIp to hash IPs before storage"
    );
    assert.ok(
      devAdminSource.includes("hashIp(entry.ipAddress)"),
      "dev-admin.ts must call hashIp on the IP address value"
    );
  });

  it("should warn when IP_HASH_SALT is not set", () => {
    assert.ok(
      auditLogSource.includes("console.warn"),
      "audit-log.ts must warn when IP_HASH_SALT env var is missing"
    );
    assert.ok(
      auditLogSource.includes("IP_HASH_SALT"),
      "Warning message should reference IP_HASH_SALT"
    );
  });

  it("should not hardcode the salt as the primary value", () => {
    // The salt should come from env var first, with fallback only as backup
    assert.ok(
      auditLogSource.includes("process.env.IP_HASH_SALT"),
      "Salt must be read from process.env.IP_HASH_SALT"
    );
    // Verify fallback pattern exists but is labeled as such
    assert.ok(
      auditLogSource.includes("effectiveSalt") || auditLogSource.includes("fallback"),
      "Fallback salt usage should be clearly labeled"
    );
  });

  it("should import hashIp from compliance/audit-log in enterprise-audit", () => {
    assert.ok(
      enterpriseAuditSource.includes('@/lib/compliance/audit-log'),
      "enterprise-audit.ts must import hashIp from the compliance module"
    );
  });

  it("should import hashIp from compliance/audit-log in dev-admin", () => {
    assert.ok(
      devAdminSource.includes('@/lib/compliance/audit-log'),
      "dev-admin.ts must import hashIp from the compliance module"
    );
  });
});
