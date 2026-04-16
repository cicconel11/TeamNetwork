import { describe, it } from "node:test";
import assert from "node:assert";
import { randomUUID } from "crypto";

/**
 * Tests for GET /api/organizations/[organizationId]/exports/donations
 *
 * Route relies on RLS (is_org_admin) via the user client. We simulate the
 * admin-check + RLS filter gate to verify the route's gating semantics
 * after removing the service-role escalation.
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

function simulateDonationsExport(req: ExportRequest, rowsInOrg: number): ExportResult {
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

describe("GET /api/organizations/[organizationId]/exports/donations", () => {
  it("returns 200 with rows for org admin", () => {
    const orgId = randomUUID();
    const result = simulateDonationsExport(
      {
        userId: randomUUID(),
        organizationId: orgId,
        role: "admin",
        status: "active",
        roleOrgId: orgId,
      },
      5,
    );
    assert.equal(result.status, 200);
    assert.equal(result.rowCount, 5);
  });

  it("returns 403 for non-admin member", () => {
    const orgId = randomUUID();
    const result = simulateDonationsExport(
      {
        userId: randomUUID(),
        organizationId: orgId,
        role: "active_member",
        status: "active",
        roleOrgId: orgId,
      },
      5,
    );
    assert.equal(result.status, 403);
  });

  it("returns 403 for revoked admin", () => {
    const orgId = randomUUID();
    const result = simulateDonationsExport(
      {
        userId: randomUUID(),
        organizationId: orgId,
        role: "admin",
        status: "revoked",
        roleOrgId: orgId,
      },
      5,
    );
    assert.equal(result.status, 403);
  });

  it("returns 403 for admin of a different org (RLS would filter rows)", () => {
    const orgId = randomUUID();
    const otherOrgId = randomUUID();
    const result = simulateDonationsExport(
      {
        userId: randomUUID(),
        organizationId: orgId,
        role: "admin",
        status: "active",
        roleOrgId: otherOrgId,
      },
      5,
    );
    assert.equal(result.status, 403);
  });

  it("returns 401 when unauthenticated", () => {
    const orgId = randomUUID();
    const result = simulateDonationsExport(
      {
        userId: null,
        organizationId: orgId,
        role: null,
        status: null,
      },
      5,
    );
    assert.equal(result.status, 401);
  });

  it("returns 400 on invalid org uuid", () => {
    const result = simulateDonationsExport(
      {
        userId: randomUUID(),
        organizationId: "not-a-uuid",
        role: "admin",
        status: "active",
        roleOrgId: "not-a-uuid",
      },
      0,
    );
    assert.equal(result.status, 400);
  });
});
