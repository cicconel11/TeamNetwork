/**
 * Owner-only networking-consent authZ — behavioral / simulation coverage.
 *
 * The existing connections-consent.test.ts greps the source for the right
 * shape. This file instead SIMULATES the two enforcement layers and asserts
 * their allow/deny decisions across cases, mirroring the repo convention of
 * simulating access-control logic rather than importing route handlers (see
 * tests/parents-rls.test.ts).
 *
 * Two layers proven here:
 *   1. DB trigger enforce_open_to_networking_owner (migration 20261227000000)
 *      — modeled as a pure predicate from the actual trigger SQL.
 *   2. PATCH/GET handler authZ decision (networking-consent/route.ts)
 *      — modeled as a pure function from the actual handler logic.
 *
 * Run: node --import ./tests/register-ts-loader.mjs --test tests/connections-consent-authz.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";

// ── Layer 1: enforce_open_to_networking_owner trigger simulation ─────────────────
//
// Mirrors migration 20261227000000_open_to_networking_flag.sql, lines ~35-71:
//
//   IF NEW.open_to_networking IS DISTINCT FROM OLD.open_to_networking THEN
//     IF NEW.user_id IS NULL OR auth.uid() IS NULL OR auth.uid() <> NEW.user_id THEN
//       RAISE EXCEPTION ... USING ERRCODE = '42501';
//     END IF;
//   END IF;
//
// The trigger only guards the open_to_networking column: when the flag does not
// change it is a no-op (allow), regardless of who the caller is.

interface TriggerInput {
  /** auth.uid() — null for service-role / no JWT context. */
  authUid: string | null;
  /** NEW.user_id — null for an unclaimed people-row. */
  rowUserId: string | null;
  /** NEW.open_to_networking IS DISTINCT FROM OLD.open_to_networking */
  flagChanged: boolean;
}

const TRIGGER_ERRCODE = "42501"; // insufficient_privilege

class OpenToNetworkingOwnerError extends Error {
  readonly code = TRIGGER_ERRCODE;
  constructor() {
    super("open_to_networking can only be changed by the row owner");
    this.name = "OpenToNetworkingOwnerError";
  }
}

/**
 * Pure predicate reproducing enforce_open_to_networking_owner.
 * Returns true (ALLOW) when the trigger lets the update through; throws
 * OpenToNetworkingOwnerError (the 42501 case) when the trigger raises.
 */
function triggerAllows({ authUid, rowUserId, flagChanged }: TriggerInput): true {
  if (!flagChanged) return true; // trigger only guards the column
  const isOwner = authUid !== null && rowUserId !== null && authUid === rowUserId;
  if (!isOwner) throw new OpenToNetworkingOwnerError();
  return true;
}

describe("enforce_open_to_networking_owner trigger (DB-layer owner-only guard)", () => {
  const owner = randomUUID();
  const other = randomUUID();

  it("owner flips own flag (authUid === rowUserId, flag changed) → ALLOW", () => {
    assert.equal(triggerAllows({ authUid: owner, rowUserId: owner, flagChanged: true }), true);
  });

  it("admin flips another user's flag (authUid !== rowUserId, flag changed) → DENY (42501)", () => {
    assert.throws(
      () => triggerAllows({ authUid: other, rowUserId: owner, flagChanged: true }),
      (err: unknown) =>
        err instanceof OpenToNetworkingOwnerError && err.code === TRIGGER_ERRCODE
    );
  });

  it("non-owner edits a DIFFERENT column (flag NOT changed) → ALLOW (column-scoped guard)", () => {
    assert.equal(triggerAllows({ authUid: other, rowUserId: owner, flagChanged: false }), true);
  });

  it("unclaimed row (rowUserId === null), any non-null caller changing flag → DENY", () => {
    assert.throws(
      () => triggerAllows({ authUid: other, rowUserId: null, flagChanged: true }),
      OpenToNetworkingOwnerError
    );
  });

  it("unclaimed row (rowUserId === null), flag NOT changed → ALLOW (no-op on the column)", () => {
    assert.equal(triggerAllows({ authUid: other, rowUserId: null, flagChanged: false }), true);
  });

  it("service-role / no auth context (authUid === null) changing flag → DENY", () => {
    assert.throws(
      () => triggerAllows({ authUid: null, rowUserId: owner, flagChanged: true }),
      OpenToNetworkingOwnerError
    );
  });

  it("service-role (authUid === null) on an unclaimed row, flag changed → DENY", () => {
    assert.throws(
      () => triggerAllows({ authUid: null, rowUserId: null, flagChanged: true }),
      OpenToNetworkingOwnerError
    );
  });

  it("service-role (authUid === null), flag NOT changed → ALLOW (trigger is a no-op)", () => {
    assert.equal(triggerAllows({ authUid: null, rowUserId: owner, flagChanged: false }), true);
  });
});

// ── Layer 2: PATCH/GET handler authZ decision simulation ─────────────────────────
//
// Mirrors src/app/api/organizations/[organizationId]/connections/networking-consent/route.ts.
//   * authorize(): no user → 401; role not in CHAT_ELIGIBLE_ORG_ROLES → 403.
//   * PATCH: updates every owned row WHERE user_id = caller; updatedRows === 0
//     → 409 { code: "no_profile" }; otherwise 200.
// The update filter is .eq("user_id", user.id) — it can never target a victim row.

// Quoted verbatim from src/lib/chat/recipient-eligibility.ts.
const CHAT_ELIGIBLE_ORG_ROLES = ["admin", "active_member", "alumni", "parent"] as const;
type ChatEligibleOrgRole = (typeof CHAT_ELIGIBLE_ORG_ROLES)[number];

interface PeopleRow {
  organization_id: string;
  user_id: string | null;
  deleted_at: string | null;
}

interface HandlerInput {
  /** supabase.auth.getUser() result — null when unauthenticated. */
  userId: string | null;
  /** normalizeRole(membership.role) — null when no/invalid membership. */
  role: string | null;
  organizationId: string;
  /** All people-rows across members/alumni/parents for the org under test. */
  rows: PeopleRow[];
}

interface HandlerDecision {
  status: number;
  code?: string;
  /** The user_id the UPDATE filter targeted (for the 200 path). */
  targetedUserId?: string;
  /** Number of owned rows the scoped UPDATE matched. */
  updatedRows?: number;
}

function isEligible(role: string | null): role is ChatEligibleOrgRole {
  return role !== null && (CHAT_ELIGIBLE_ORG_ROLES as readonly string[]).includes(role);
}

/**
 * Pure reproduction of the PATCH handler's authZ decision.
 * Mirrors the status codes in the route: 401 / 403 / 409 (no_profile) / 200.
 */
function simulateConsentPatch(input: HandlerInput): HandlerDecision {
  if (!input.userId) return { status: 401 };
  if (!isEligible(input.role)) return { status: 403 };

  // The scoped UPDATE: .eq("organization_id", orgId).eq("user_id", user.id).is("deleted_at", null).
  // Crucially filtered by the caller's own id — never a victim's.
  const updatedRows = input.rows.filter(
    (r) =>
      r.organization_id === input.organizationId &&
      r.user_id === input.userId &&
      r.deleted_at === null
  ).length;

  if (updatedRows === 0) return { status: 409, code: "no_profile" };

  return { status: 200, targetedUserId: input.userId, updatedRows };
}

describe("networking-consent PATCH handler authZ decision", () => {
  const caller = randomUUID();
  const victim = randomUUID();
  const orgId = "org-1";

  const ownedRow: PeopleRow = { organization_id: orgId, user_id: caller, deleted_at: null };
  const victimRow: PeopleRow = { organization_id: orgId, user_id: victim, deleted_at: null };

  it("unauthenticated (no user) → 401", () => {
    const result = simulateConsentPatch({
      userId: null,
      role: null,
      organizationId: orgId,
      rows: [ownedRow],
    });
    assert.equal(result.status, 401);
  });

  it("authenticated but role NOT in CHAT_ELIGIBLE_ORG_ROLES → 403", () => {
    // e.g. a "guest"/unknown role normalizes to something outside the eligible set.
    const result = simulateConsentPatch({
      userId: caller,
      role: "guest",
      organizationId: orgId,
      rows: [ownedRow],
    });
    assert.equal(result.status, 403);
  });

  it("null role (no active membership) → 403", () => {
    const result = simulateConsentPatch({
      userId: caller,
      role: null,
      organizationId: orgId,
      rows: [ownedRow],
    });
    assert.equal(result.status, 403);
  });

  it("eligible role, no owned profile row (updatedRows === 0) → 409 code no_profile", () => {
    // Only a victim row exists; the user_id-scoped UPDATE matches nothing.
    const result = simulateConsentPatch({
      userId: caller,
      role: "active_member",
      organizationId: orgId,
      rows: [victimRow],
    });
    assert.equal(result.status, 409);
    assert.equal(result.code, "no_profile");
  });

  it("eligible role, owned row → 200 and UPDATE targets caller's own user_id", () => {
    const result = simulateConsentPatch({
      userId: caller,
      role: "active_member",
      organizationId: orgId,
      rows: [ownedRow, victimRow],
    });
    assert.equal(result.status, 200);
    assert.equal(result.targetedUserId, caller);
    assert.equal(result.updatedRows, 1); // the victim row is NOT touched
  });

  it("every chat-eligible role can opt in for their own owned row → 200", () => {
    for (const role of CHAT_ELIGIBLE_ORG_ROLES) {
      const result = simulateConsentPatch({
        userId: caller,
        role,
        organizationId: orgId,
        rows: [ownedRow],
      });
      assert.equal(result.status, 200, `role ${role} should be allowed`);
      assert.equal(result.targetedUserId, caller);
    }
  });

  it("eligible caller cannot flip a victim's row even if it is in scope → 409 (filter excludes it)", () => {
    // Caller is eligible but owns nothing; only the victim's opted-out row exists.
    // The user_id filter means the victim row is never selected for UPDATE.
    const result = simulateConsentPatch({
      userId: caller,
      role: "admin",
      organizationId: orgId,
      rows: [victimRow],
    });
    assert.equal(result.status, 409);
    assert.equal(result.code, "no_profile");
    assert.notEqual(result.targetedUserId, victim);
  });

  it("soft-deleted owned row is ignored (is deleted_at null filter) → 409", () => {
    const deletedOwnRow: PeopleRow = {
      organization_id: orgId,
      user_id: caller,
      deleted_at: new Date().toISOString(),
    };
    const result = simulateConsentPatch({
      userId: caller,
      role: "alumni",
      organizationId: orgId,
      rows: [deletedOwnRow],
    });
    assert.equal(result.status, 409);
    assert.equal(result.code, "no_profile");
  });

  it("owned rows in a DIFFERENT org are ignored (org scoping) → 409", () => {
    const otherOrgRow: PeopleRow = {
      organization_id: "org-2",
      user_id: caller,
      deleted_at: null,
    };
    const result = simulateConsentPatch({
      userId: caller,
      role: "parent",
      organizationId: orgId,
      rows: [otherOrgRow],
    });
    assert.equal(result.status, 409);
    assert.equal(result.code, "no_profile");
  });
});

// ── Layer 2 (GET): same authZ gate, value reflects any owned opted-in row ────────
//
// GET shares authorize(): 401 / 403 then reads the viewer's own rows and returns
// open_to_networking = true if any owned row opted in. Mirrors route.ts GET.

interface GetPeopleRow extends PeopleRow {
  open_to_networking: boolean;
}

interface GetDecision {
  status: number;
  open_to_networking?: boolean;
}

function simulateConsentGet(input: {
  userId: string | null;
  role: string | null;
  organizationId: string;
  rows: GetPeopleRow[];
}): GetDecision {
  if (!input.userId) return { status: 401 };
  if (!isEligible(input.role)) return { status: 403 };

  const optedIn = input.rows.some(
    (r) =>
      r.organization_id === input.organizationId &&
      r.user_id === input.userId &&
      r.deleted_at === null &&
      r.open_to_networking === true
  );
  return { status: 200, open_to_networking: optedIn };
}

describe("networking-consent GET handler authZ decision", () => {
  const caller = randomUUID();
  const victim = randomUUID();
  const orgId = "org-1";

  it("unauthenticated → 401", () => {
    assert.equal(
      simulateConsentGet({ userId: null, role: "admin", organizationId: orgId, rows: [] }).status,
      401
    );
  });

  it("ineligible role → 403", () => {
    assert.equal(
      simulateConsentGet({ userId: caller, role: "guest", organizationId: orgId, rows: [] }).status,
      403
    );
  });

  it("eligible, an owned row opted in → 200 open_to_networking true", () => {
    const result = simulateConsentGet({
      userId: caller,
      role: "active_member",
      organizationId: orgId,
      rows: [{ organization_id: orgId, user_id: caller, deleted_at: null, open_to_networking: true }],
    });
    assert.equal(result.status, 200);
    assert.equal(result.open_to_networking, true);
  });

  it("eligible, only a VICTIM's row opted in → 200 open_to_networking false (own value only)", () => {
    const result = simulateConsentGet({
      userId: caller,
      role: "active_member",
      organizationId: orgId,
      rows: [{ organization_id: orgId, user_id: victim, deleted_at: null, open_to_networking: true }],
    });
    assert.equal(result.status, 200);
    assert.equal(result.open_to_networking, false);
  });
});
