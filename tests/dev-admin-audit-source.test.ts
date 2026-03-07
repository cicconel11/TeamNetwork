import test from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const auditRoutePath = path.join(repoRoot, "src/app/api/dev-admin/audit/route.ts");
const middlewarePath = path.join(repoRoot, "src/middleware.ts");
const bugStatusRoutePath = path.join(repoRoot, "src/app/api/admin/bugs/[groupId]/status/route.ts");

test("spoofable dev-admin audit API route is removed", () => {
  assert.strictEqual(
    existsSync(auditRoutePath),
    false,
    "src/app/api/dev-admin/audit/route.ts should be deleted"
  );
});

test("middleware no longer posts audit entries over fetch", () => {
  const middlewareSource = readFileSync(middlewarePath, "utf8");

  assert.ok(
    !middlewareSource.includes("/api/dev-admin/audit"),
    "middleware should not call the removed audit endpoint"
  );
  assert.ok(
    !middlewareSource.includes("fetch(url.toString()"),
    "middleware should not send audit logs over HTTP"
  );
});

test("error group audit entries use the correct target type", () => {
  const source = readFileSync(bugStatusRoutePath, "utf8");

  assert.ok(
    source.includes('targetType: "error_group"'),
    "bug status route should log targetType as error_group"
  );
  assert.ok(
    !source.includes('targetType: "organization"'),
    "bug status route should not log targetType as organization"
  );
});
