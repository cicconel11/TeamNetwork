import test from "node:test";
import assert from "node:assert";

import {
  createMiddlewareAuditEntry,
  fireAndForgetDevAdminAudit,
  writeDevAdminAuditLog,
} from "../src/lib/auth/dev-admin.ts";

test("createMiddlewareAuditEntry returns null for non-dev-admin users", () => {
  const entry = createMiddlewareAuditEntry({
    userId: "user-1",
    userEmail: "member@example.com",
    action: "view_org",
    targetSlug: "acme",
    pathname: "/acme/members",
    method: "GET",
    headers: new Headers(),
  });

  assert.strictEqual(entry, null);
});

test("createMiddlewareAuditEntry builds org audit entry for dev-admin users", () => {
  process.env.DEV_ADMIN_EMAILS = "dev@example.com";

  const entry = createMiddlewareAuditEntry({
    userId: "dev-1",
    userEmail: "dev@example.com",
    action: "view_org",
    targetSlug: "acme",
    pathname: "/acme/members",
    method: "GET",
    headers: new Headers({
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      "user-agent": "node-test",
    }),
  });

  assert.ok(entry);
  assert.strictEqual(entry?.adminUserId, "dev-1");
  assert.strictEqual(entry?.adminEmail, "dev@example.com");
  assert.strictEqual(entry?.action, "view_org");
  assert.strictEqual(entry?.targetType, "organization");
  assert.strictEqual(entry?.targetSlug, "acme");
  assert.strictEqual(entry?.requestPath, "/acme/members");
  assert.strictEqual(entry?.requestMethod, "GET");
  assert.strictEqual(entry?.ipAddress, "203.0.113.10");
  assert.strictEqual(entry?.userAgent, "node-test");
  assert.deepStrictEqual(entry?.metadata, { source: "middleware" });
});

test("fireAndForgetDevAdminAudit swallows logger failures", async () => {
  let loggerCalls = 0;
  const entry = {
    adminUserId: "dev-1",
    adminEmail: "dev@example.com",
    action: "view_org" as const,
    targetType: "organization" as const,
    targetSlug: "acme",
  };

  await assert.doesNotReject(async () => {
    await fireAndForgetDevAdminAudit(entry, async () => {
      loggerCalls += 1;
      throw new Error("db unavailable");
    });
  });

  assert.strictEqual(loggerCalls, 1);
});

test("writeDevAdminAuditLog inserts the audit row via injected client", async () => {
  const inserts: Array<Record<string, unknown>> = [];

  await writeDevAdminAuditLog(
    {
      adminUserId: "dev-1",
      adminEmail: "dev@example.com",
      action: "manage_error_groups",
      targetType: "error_group",
      targetId: "group-1",
      requestPath: "/api/admin/bugs/group-1/status",
      requestMethod: "POST",
      metadata: { newStatus: "ignored" },
    },
    () =>
      ({
        from(table: string) {
          assert.strictEqual(table, "dev_admin_audit_logs");
          return {
            async insert(payload: Record<string, unknown>) {
              inserts.push(payload);
              return { error: null };
            },
          };
        },
      }) as never
  );

  assert.strictEqual(inserts.length, 1);
  assert.strictEqual(inserts[0].admin_user_id, "dev-1");
  assert.strictEqual(inserts[0].action, "manage_error_groups");
  assert.strictEqual(inserts[0].target_type, "error_group");
  assert.strictEqual(inserts[0].target_id, "group-1");
  assert.strictEqual(inserts[0].request_path, "/api/admin/bugs/group-1/status");
  assert.deepStrictEqual(inserts[0].metadata, { newStatus: "ignored" });
});
