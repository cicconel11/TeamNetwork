import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { claimOrgInviteUse } from "@/app/api/organizations/[organizationId]/parents/invite/accept/claim-org-invite-use";

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

interface ClaimOrgInviteRow {
  id: string;
  organization_id: string | null;
  role: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  uses_remaining: number | null;
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

function makeClaimOrgInviteRow(overrides: Partial<ClaimOrgInviteRow> = {}): ClaimOrgInviteRow {
  return {
    id: randomUUID(),
    organization_id: "org-1",
    role: "parent",
    uses_remaining: null,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    revoked_at: null,
    ...overrides,
  };
}

function createClaimOrgInviteUseStub(
  invite: ClaimOrgInviteRow,
  options: {
    claimCasMissesBeforeSuccess?: number;
  } = {},
) {
  let claimCasMissesRemaining = options.claimCasMissesBeforeSuccess ?? 0;

  return {
    from(table: string) {
      assert.equal(table, "organization_invites");

      const filters: Array<(row: ClaimOrgInviteRow) => boolean> = [];

      const builder = {
        select(columns: string) {
          void columns;
          return builder;
        },
        update(payload: Partial<ClaimOrgInviteRow>) {
          return {
            eq(field: keyof ClaimOrgInviteRow, value: unknown) {
              filters.push((row) => row[field] === value);
              return this;
            },
            is(field: keyof ClaimOrgInviteRow, value: unknown) {
              filters.push((row) => row[field] === value);
              return this;
            },
            gt(field: keyof ClaimOrgInviteRow, value: unknown) {
              filters.push((row) => {
                const candidate = row[field];
                if (candidate == null) return false;
                return new Date(String(candidate)).getTime() > new Date(String(value)).getTime();
              });
              return this;
            },
            async select(updateColumns: string) {
              void updateColumns;
              if (!filters.every((filter) => filter(invite))) {
                return { data: [], error: null };
              }

              if (claimCasMissesRemaining > 0) {
                claimCasMissesRemaining -= 1;
                return { data: [], error: null };
              }

              Object.assign(invite, payload);
              return { data: [{ id: invite.id }], error: null };
            },
          };
        },
        eq(field: keyof ClaimOrgInviteRow, value: unknown) {
          filters.push((row) => row[field] === value);
          return builder;
        },
        maybeSingle: async () => ({
          data: filters.every((filter) => filter(invite)) ? { ...invite } : null,
          error: null,
        }),
      };

      return builder;
    },
  };
}

const respond = (payload: unknown, status = 200) => NextResponse.json(payload, { status });

interface AcceptParentInviteOptions {
  orgId: string;
  code: string;
  orgInvite?: OrgParentInvite | null;
  legacyInvite?: LegacyParentInvite | null;
  orgInviteInOtherOrg?: OrgParentInvite | null;
  legacyInviteInOtherOrg?: LegacyParentInvite | null;
  expireBeforeClaim?: boolean;
}

const CLAIM_CONTENTION_ERROR = "Invite is currently being redeemed. Please try again.";

function simulateAcceptParentInvite(
  opts: AcceptParentInviteOptions,
): { status: number; error?: string } {
  const orgInvite = opts.orgInvite ?? null;
  const legacyInvite = opts.legacyInvite ?? null;
  const orgInviteInOtherOrg = opts.orgInviteInOtherOrg ?? null;
  const legacyInviteInOtherOrg = opts.legacyInviteInOtherOrg ?? null;

  // The real route scopes both lookups to the org in the URL, so unrelated rows are invisible.
  void orgInviteInOtherOrg;
  void legacyInviteInOtherOrg;

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
      if (opts.expireBeforeClaim) {
        orgInvite.expires_at = new Date(Date.now() - 1000).toISOString();
      }
      if (orgInvite.expires_at && new Date(orgInvite.expires_at) < new Date()) {
        return { status: 410, error: "Invite has expired" };
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

function simulateClaimOrgInviteUseWithContention(
  invite: OrgParentInvite,
  casFailuresBeforeSuccess: number,
  maxAttempts = 5,
): { status: number; error?: string; claimed?: boolean } {
  let failuresRemaining = casFailuresBeforeSuccess;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (invite.revoked_at) {
      return { status: 410, error: "Invite has been revoked" };
    }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return { status: 410, error: "Invite has expired" };
    }
    if (invite.uses_remaining == null) {
      return { status: 200, claimed: true };
    }
    if (invite.uses_remaining <= 0) {
      return { status: 409, error: "Invite has no uses remaining" };
    }

    if (failuresRemaining > 0) {
      failuresRemaining -= 1;
      continue;
    }

    invite.uses_remaining -= 1;
    return { status: 200, claimed: true };
  }

  if (invite.revoked_at) {
    return { status: 410, error: "Invite has been revoked" };
  }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return { status: 410, error: "Invite has expired" };
  }
  if (invite.uses_remaining !== null && invite.uses_remaining <= 0) {
    return { status: 409, error: "Invite has no uses remaining" };
  }

  return { status: 409, error: CLAIM_CONTENTION_ERROR };
}

function createLimitedUseClaimRollback(
  invite: OrgParentInvite,
  maxAttempts = 5,
): () => void {
  let consumed = false;

  return () => {
    if (consumed || invite.uses_remaining == null) {
      return;
    }

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (invite.uses_remaining < 0) {
        return;
      }

      invite.uses_remaining += 1;
      consumed = true;
      return;
    }
  };
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

test("same code in another org does not interfere with org-scoped parent invite redemption", () => {
  const invite = makeOrgParentInvite({ organization_id: "org-1", code: "SHARED01" });
  const otherOrgInvite = makeOrgParentInvite({ organization_id: "org-2", code: "SHARED01" });
  const otherOrgLegacyInvite = makeLegacyParentInvite({ organization_id: "org-2", code: "SHARED01" });

  const result = simulateAcceptParentInvite({
    orgId: "org-1",
    code: invite.code,
    orgInvite: invite,
    orgInviteInOtherOrg: otherOrgInvite,
    legacyInviteInOtherOrg: otherOrgLegacyInvite,
  });

  assert.equal(result.status, 200);
  assert.equal(invite.uses_remaining, null);
});

test("limited parent org invite that expires before claim is rejected and does not consume a use", () => {
  const invite = makeOrgParentInvite({ uses_remaining: 1 });

  const result = simulateAcceptParentInvite({
    orgId: "org-1",
    code: invite.code,
    orgInvite: invite,
    expireBeforeClaim: true,
  });

  assert.equal(result.status, 410);
  assert.equal(result.error, "Invite has expired");
  assert.equal(invite.uses_remaining, 1);
});

test("claimOrgInviteUse does not report exhaustion after repeated CAS misses while capacity remains", async () => {
  const invite = makeClaimOrgInviteRow({ uses_remaining: 2 });
  const serviceSupabase = createClaimOrgInviteUseStub(invite, {
    claimCasMissesBeforeSuccess: 5,
  });

  const result = await claimOrgInviteUse(serviceSupabase as never, invite.id, respond);

  assert.ok("response" in result, "expected contention response");
  assert.equal(result.response.status, 409);
  assert.deepEqual(await result.response.json(), {
    error: CLAIM_CONTENTION_ERROR,
  });
  assert.equal(invite.uses_remaining, 2);
});

test("claimOrgInviteUse rollback restores a failed limited-use claim after another redemption wins", async () => {
  const invite = makeClaimOrgInviteRow({ uses_remaining: 2 });
  const serviceSupabase = createClaimOrgInviteUseStub(invite);

  const result = await claimOrgInviteUse(serviceSupabase as never, invite.id, respond);

  assert.ok(!("response" in result), "expected successful claim");
  assert.equal(invite.uses_remaining, 1);

  invite.uses_remaining = 0;
  await result.rollback();

  assert.equal(invite.uses_remaining, 1);
});

test("limited parent org invite does not report exhaustion after repeated CAS misses while capacity remains", () => {
  const invite = makeOrgParentInvite({ uses_remaining: 2 });

  const result = simulateClaimOrgInviteUseWithContention(invite, 5, 2);

  assert.equal(result.status, 409);
  assert.equal(result.error, CLAIM_CONTENTION_ERROR);
  assert.equal(invite.uses_remaining, 2);
});

test("failed signup restores one limited-use slot even after another redemption wins", () => {
  const invite = makeOrgParentInvite({ uses_remaining: 2 });

  const firstClaim = simulateClaimOrgInviteUseWithContention(invite, 0);
  assert.equal(firstClaim.status, 200);
  assert.equal(invite.uses_remaining, 1);

  const rollback = createLimitedUseClaimRollback(invite);

  const secondClaim = simulateClaimOrgInviteUseWithContention(invite, 0);
  assert.equal(secondClaim.status, 200);
  assert.equal(invite.uses_remaining, 0);

  rollback();

  assert.equal(invite.uses_remaining, 1);
});
