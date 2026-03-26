import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";

interface OrgParentInvite {
  id: string;
  organization_id: string;
  code: string;
  role: "parent";
  uses_remaining: number | null;
  expires_at: string | null;
  revoked_at: string | null;
}

interface LegacyParentInvite {
  id: string;
  organization_id: string;
  code: string;
  status: "pending" | "accepted" | "revoked";
  expires_at: string;
}

function makeOrgParentInvite(overrides: Partial<OrgParentInvite> = {}): OrgParentInvite {
  return {
    id: randomUUID(),
    organization_id: "org-1",
    code: "PARENT01",
    role: "parent",
    uses_remaining: null,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    revoked_at: null,
    ...overrides,
  };
}

function makeLegacyParentInvite(overrides: Partial<LegacyParentInvite> = {}): LegacyParentInvite {
  return {
    id: randomUUID(),
    organization_id: "org-1",
    code: "LEGACY01",
    status: "pending",
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

interface AcceptParentInviteOptions {
  orgId: string;
  code: string;
  orgInvite?: OrgParentInvite | null;
  legacyInvite?: LegacyParentInvite | null;
}

function simulateAcceptParentInvite(
  opts: AcceptParentInviteOptions,
): { status: number; error?: string } {
  const orgInvite = opts.orgInvite ?? null;
  const legacyInvite = opts.legacyInvite ?? null;

  if (orgInvite && legacyInvite) {
    return {
      status: 409,
      error: "Invite code conflict. Please ask your administrator for a new parent invite link.",
    };
  }

  if (orgInvite) {
    if (orgInvite.organization_id !== opts.orgId) {
      return { status: 400, error: "Invalid invite code" };
    }
    if (orgInvite.revoked_at) {
      return { status: 410, error: "Invite has been revoked" };
    }
    if (orgInvite.expires_at && new Date(orgInvite.expires_at) < new Date()) {
      return { status: 410, error: "Invite has expired" };
    }
    if (orgInvite.uses_remaining !== null) {
      if (orgInvite.uses_remaining <= 0) {
        return { status: 409, error: "Invite has no uses remaining" };
      }
      orgInvite.uses_remaining -= 1;
    }
    return { status: 200 };
  }

  if (!legacyInvite) {
    return { status: 400, error: "Invalid invite code" };
  }

  if (legacyInvite.organization_id !== opts.orgId) {
    return { status: 400, error: "Invalid invite code" };
  }
  if (legacyInvite.status === "accepted") {
    return { status: 409, error: "Invite already accepted" };
  }
  if (legacyInvite.status === "revoked") {
    return { status: 410, error: "Invite has been revoked" };
  }
  if (new Date(legacyInvite.expires_at) < new Date()) {
    return { status: 410, error: "Invite has expired" };
  }

  legacyInvite.status = "accepted";
  return { status: 200 };
}

test("unlimited parent org invite can be redeemed by multiple parents", () => {
  const invite = makeOrgParentInvite({ uses_remaining: null });

  const first = simulateAcceptParentInvite({
    orgId: "org-1",
    code: invite.code,
    orgInvite: invite,
  });
  const second = simulateAcceptParentInvite({
    orgId: "org-1",
    code: invite.code,
    orgInvite: invite,
  });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(invite.uses_remaining, null);
});

test("limited parent org invite decrements and then exhausts", () => {
  const invite = makeOrgParentInvite({ uses_remaining: 1 });

  const first = simulateAcceptParentInvite({
    orgId: "org-1",
    code: invite.code,
    orgInvite: invite,
  });
  const second = simulateAcceptParentInvite({
    orgId: "org-1",
    code: invite.code,
    orgInvite: invite,
  });

  assert.equal(first.status, 200);
  assert.equal(invite.uses_remaining, 0);
  assert.equal(second.status, 409);
  assert.equal(second.error, "Invite has no uses remaining");
});

test("legacy parent invite remains single-use for backward compatibility", () => {
  const invite = makeLegacyParentInvite();

  const first = simulateAcceptParentInvite({
    orgId: "org-1",
    code: invite.code,
    legacyInvite: invite,
  });
  const second = simulateAcceptParentInvite({
    orgId: "org-1",
    code: invite.code,
    legacyInvite: invite,
  });

  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(second.error, "Invite already accepted");
});
