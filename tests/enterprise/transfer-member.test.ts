import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTransferPreflight } from "@/lib/enterprise/transfer-member";

function buildContext(overrides?: {
  sourceOrgNamesById?: Map<string, string>;
  sourceMembershipsByKey?: Map<string, { role: string; status: string | null }>;
  activeAdminCountsByOrgId?: Map<string, number>;
  manageableSourceOrgIds?: Set<string>;
}) {
  return {
    sourceOrgNamesById:
      overrides?.sourceOrgNamesById ??
      new Map([
        ["org-1", "Alpha Org"],
        ["org-2", "Beta Org"],
      ]),
    sourceMembershipsByKey:
      overrides?.sourceMembershipsByKey ??
      new Map([
        ["user-1:org-1", { role: "active_member", status: "active" }],
      ]),
    activeAdminCountsByOrgId:
      overrides?.activeAdminCountsByOrgId ?? new Map([["org-1", 1]]),
    manageableSourceOrgIds: overrides?.manageableSourceOrgIds,
  };
}

test("evaluateTransferPreflight rejects orgs outside the enterprise", () => {
  const result = evaluateTransferPreflight(
    [{ userId: "user-1", sourceOrgId: "org-9", action: "copy" }],
    buildContext()
  );

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: "Source organization does not belong to this enterprise",
  });
});

test("evaluateTransferPreflight rejects inactive source memberships", () => {
  const result = evaluateTransferPreflight(
    [{ userId: "user-1", sourceOrgId: "org-1", action: "copy" }],
    buildContext({
      sourceMembershipsByKey: new Map([
        ["user-1:org-1", { role: "active_member", status: "revoked" }],
      ]),
    })
  );

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: "Member user-1 is not active in the selected source organization.",
  });
});

test("evaluateTransferPreflight enforces org_admin source-org scoping", () => {
  const result = evaluateTransferPreflight(
    [{ userId: "user-1", sourceOrgId: "org-1", action: "copy" }],
    buildContext({
      manageableSourceOrgIds: new Set(["org-2"]),
    }),
    "org_admin"
  );

  assert.deepEqual(result, {
    ok: false,
    status: 403,
    error: "You can only transfer members from organizations you actively administer.",
  });
});

test("evaluateTransferPreflight rejects moving the final admin out of an org", () => {
  const result = evaluateTransferPreflight(
    [{ userId: "user-1", sourceOrgId: "org-1", action: "move" }],
    buildContext({
      sourceMembershipsByKey: new Map([
        ["user-1:org-1", { role: "admin", status: "active" }],
      ]),
      activeAdminCountsByOrgId: new Map([["org-1", 1]]),
    })
  );

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: "Cannot move all admins out of Alpha Org.",
  });
});

test("evaluateTransferPreflight rejects batches that move every admin from an org", () => {
  const result = evaluateTransferPreflight(
    [
      { userId: "user-1", sourceOrgId: "org-1", action: "move" },
      { userId: "user-2", sourceOrgId: "org-1", action: "move" },
    ],
    buildContext({
      sourceMembershipsByKey: new Map([
        ["user-1:org-1", { role: "admin", status: "active" }],
        ["user-2:org-1", { role: "admin", status: "active" }],
      ]),
      activeAdminCountsByOrgId: new Map([["org-1", 2]]),
    })
  );

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: "Cannot move all admins out of Alpha Org.",
  });
});

test("evaluateTransferPreflight accepts valid member copies", () => {
  const result = evaluateTransferPreflight(
    [{ userId: "user-1", sourceOrgId: "org-1", action: "copy" }],
    buildContext()
  );

  assert.deepEqual(result, { ok: true });
});
