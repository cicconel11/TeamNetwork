import { describe, it } from "node:test";
import assert from "node:assert";
import { randomUUID } from "crypto";

/**
 * Tests for GET /api/organizations/[organizationId]/exports/philanthropy
 *
 * After removing the service client escalation, the route relies on RLS
 * (events_select) + an explicit admin-role check. We simulate both layers.
 */

type OrgRole = "admin" | "active_member" | "alumni" | "parent" | null;
type RoleStatus = "active" | "revoked" | "pending";

interface ExportRequest {
  userId: string | null;
  organizationId: string;
  role: OrgRole;
  status: RoleStatus | null;
  roleOrgId?: string;
}

interface ExportResult {
  status: number;
  rowCount?: number;
  error?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function simulatePhilanthropyExport(req: ExportRequest, rowsInOrg: number): ExportResult {
  if (!UUID_PATTERN.test(req.organizationId)) {
    return { status: 400, error: "Invalid organization id" };
  }
  if (!req.userId) {
    return { status: 401, error: "Unauthorized" };
  }
  const roleMatchesOrg = req.roleOrgId === req.organizationId;
  const isAdmin = roleMatchesOrg && req.role === "admin" && req.status === "active";
  if (!isAdmin) {
    return { status: 403, error: "Forbidden" };
  }
  return { status: 200, rowCount: rowsInOrg };
}

describe("GET /api/organizations/[organizationId]/exports/philanthropy", () => {
  it("returns 200 with rows for org admin", () => {
    const orgId = randomUUID();
    const result = simulatePhilanthropyExport(
      {
        userId: randomUUID(),
        organizationId: orgId,
        role: "admin",
        status: "active",
        roleOrgId: orgId,
      },
      3,
    );
    assert.equal(result.status, 200);
    assert.equal(result.rowCount, 3);
  });

  it("returns 403 for non-admin member", () => {
    const orgId = randomUUID();
    const result = simulatePhilanthropyExport(
      {
        userId: randomUUID(),
        organizationId: orgId,
        role: "active_member",
        status: "active",
        roleOrgId: orgId,
      },
      3,
    );
    assert.equal(result.status, 403);
  });

  it("returns 403 for admin of a different org", () => {
    const orgId = randomUUID();
    const otherOrgId = randomUUID();
    const result = simulatePhilanthropyExport(
      {
        userId: randomUUID(),
        organizationId: orgId,
        role: "admin",
        status: "active",
        roleOrgId: otherOrgId,
      },
      3,
    );
    assert.equal(result.status, 403);
  });

  it("returns 401 when unauthenticated", () => {
    const orgId = randomUUID();
    const result = simulatePhilanthropyExport(
      {
        userId: null,
        organizationId: orgId,
        role: null,
        status: null,
      },
      3,
    );
    assert.equal(result.status, 401);
  });
});
