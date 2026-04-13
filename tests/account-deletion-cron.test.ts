import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "path";

/**
 * Source-level assertions that the account deletion cron is properly
 * configured for FERPA "Return or Destroy" compliance.
 */
describe("Account Deletion Cron", () => {
  const cronRouteSource = readFileSync(
    join(process.cwd(), "src/app/api/cron/account-deletion/route.ts"),
    "utf-8"
  );

  const vercelConfig = JSON.parse(
    readFileSync(join(process.cwd(), "vercel.json"), "utf-8")
  );

  it("should use validateCronAuth for authentication", () => {
    assert.ok(
      cronRouteSource.includes("validateCronAuth"),
      "Cron route must use validateCronAuth to prevent unauthorized execution"
    );
  });

  it("should call auth.admin.deleteUser", () => {
    assert.ok(
      cronRouteSource.includes("deleteUser"),
      "Cron route must call auth.admin.deleteUser to actually remove user data"
    );
  });

  it("should filter by scheduled_deletion_at", () => {
    assert.ok(
      cronRouteSource.includes("scheduled_deletion_at"),
      "Cron must respect the 30-day grace period by checking scheduled_deletion_at"
    );
  });

  it("should filter by status pending", () => {
    assert.ok(
      cronRouteSource.includes('"pending"'),
      "Cron must only process pending deletion requests"
    );
  });

  it("should have a batch limit", () => {
    assert.ok(
      cronRouteSource.includes("BATCH_LIMIT") || cronRouteSource.includes(".limit("),
      "Cron must have a batch limit to prevent runaway processing"
    );
  });

  it("should be registered in vercel.json", () => {
    const cronPaths = vercelConfig.crons.map(
      (c: { path: string }) => c.path
    );
    assert.ok(
      cronPaths.includes("/api/cron/account-deletion"),
      "Account deletion cron must be registered in vercel.json"
    );
  });

  it("should update status to completed after successful deletion", () => {
    assert.ok(
      cronRouteSource.includes('"completed"'),
      "Cron must mark requests as completed after processing"
    );
  });
});
