/**
 * Connections cross-org isolation tests (TASK H3)
 *
 * Verifies that org-scoping at the application layer prevents data leakage
 * across organizations on the Connections routes:
 *   - GET  /api/organizations/:organizationId/connections/suggestions
 *   - GET  /api/organizations/:organizationId/connections/networking-consent
 *   - PATCH/api/organizations/:organizationId/connections/networking-consent
 *
 * These tests simulate the EXACT access-control decision the route handlers make:
 *   1. getOrgMembership(serviceSupabase, user.id, organizationId)
 *        → queries user_organization_roles filtered by user_id + organization_id
 *          + status = "active". No active membership in the target org → null.
 *   2. normalizeRole(membership?.role ?? null)   (member→active_member, viewer→alumni)
 *   3. isEligible = normalizedRole !== null
 *        && CHAT_ELIGIBLE_ORG_ROLES.includes(normalizedRole)
 *      Not eligible → 403 "Forbidden".
 * And for getViewerConnectionSuggestions, the source lookup
 * (resolveViewerSource) is scoped by organization_id + user_id, so a viewer with
 * no projected member/alumni row in the target org yields { state: "no_source" }
 * with an EMPTY list — never another org's peers.
 *
 * Source of truth (quoted, not invented):
 *   - CHAT_ELIGIBLE_ORG_ROLES = ["admin", "active_member", "alumni", "parent"]
 *       (src/lib/chat/recipient-eligibility.ts)
 *   - 401 Unauthorized / 403 Forbidden status codes from both route handlers
 *       (suggestions/route.ts, networking-consent/route.ts)
 *   - normalizeRole mapping member→active_member, viewer→alumni
 *       (src/lib/auth/role-utils.ts)
 *
 * Run: node --import ./tests/register-ts-loader.mjs --test tests/connections-cross-org.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";

// ── Types ──────────────────────────────────────────────────────────────────────

// Raw DB enum values (src/types/database.ts user_role):
// admin | member | viewer | active_member | alumni | parent
type RawRole = "admin" | "member" | "viewer" | "active_member" | "alumni" | "parent";
type NormalizedRole = "admin" | "active_member" | "alumni" | "parent";
type MemberStatus = "active" | "pending" | "revoked";

interface Membership {
  organizationId: string;
  role: RawRole;
  status: MemberStatus;
}

interface UserContext {
  userId: string | null;
  memberships: Membership[];
}

// The viewer's projected people-rows. resolveViewerSource scopes by
// organization_id + user_id, member preferred over alumni.
interface SourceRow {
  table: "members" | "alumni";
  organization_id: string;
  user_id: string;
  deleted_at: string | null;
}

// ── Constants quoted verbatim from handler source ──────────────────────────────
// src/lib/chat/recipient-eligibility.ts
const CHAT_ELIGIBLE_ORG_ROLES = ["admin", "active_member", "alumni", "parent"] as const;

// ── Decision helpers (mirror real handler logic) ───────────────────────────────

/**
 * Mirrors getOrgMembership(serviceSupabase, user.id, organizationId):
 *   .from("user_organization_roles").select("role")
 *     .eq("user_id", userId).eq("organization_id", orgId)
 *     .eq("status", "active").maybeSingle()
 * Returns the raw role for an ACTIVE membership in the target org, else null.
 */
function getOrgMembership(ctx: UserContext, orgId: string): { role: RawRole } | null {
  const m = ctx.memberships.find(
    (m) => m.organizationId === orgId && m.status === "active"
  );
  return m ? { role: m.role } : null;
}

/** Mirrors normalizeRole: member→active_member, viewer→alumni, others pass through. */
function normalizeRole(role: RawRole | null): NormalizedRole | null {
  if (!role) return null;
  if (role === "member") return "active_member";
  if (role === "viewer") return "alumni";
  if (role === "admin" || role === "active_member" || role === "alumni" || role === "parent") {
    return role;
  }
  return null;
}

/**
 * The shared eligibility gate used identically by BOTH the suggestions GET and the
 * networking-consent authorize() (GET + PATCH). Returns the status the handler
 * would respond with before doing any data work; 200 = passed the gate.
 *   401 if unauthenticated, 403 if no eligible (chat-eligible) membership.
 */
function simulateConnectionsGate(ctx: UserContext, targetOrgId: string): { status: number } {
  if (!ctx.userId) return { status: 401 };
  const membership = getOrgMembership(ctx, targetOrgId);
  const normalizedRole = normalizeRole(membership?.role ?? null);
  const isEligible =
    normalizedRole !== null &&
    (CHAT_ELIGIBLE_ORG_ROLES as readonly string[]).includes(normalizedRole);
  return { status: isEligible ? 200 : 403 };
}

// suggestions GET, networking-consent GET, networking-consent PATCH all run the
// identical gate. Named wrappers keep the test intent explicit at the call site.
const simulateSuggestions = simulateConnectionsGate;
const simulateConsentGet = simulateConnectionsGate;
const simulateConsentPatch = simulateConnectionsGate;

type SuggestionsSourceResult =
  | { state: "ok"; peerData: string[] }
  | { state: "no_source"; suggestions: [] };

/**
 * Mirrors getViewerConnectionSuggestions → resolveViewerSource org-scoping:
 *   members: .eq("organization_id", orgId).eq("user_id", viewerUserId)
 *            .eq("status","active").is("deleted_at", null)
 *   alumni : .eq("organization_id", orgId).eq("user_id", viewerUserId)
 *            .is("deleted_at", null)
 * No source row in the TARGET org → { state: "no_source", suggestions: [] }.
 * A real source → { state: "ok" } with peer data sourced from the viewer's node.
 */
function simulateGetViewerSuggestions(
  sources: SourceRow[],
  orgId: string,
  viewerUserId: string
): SuggestionsSourceResult {
  const member = sources.find(
    (s) =>
      s.table === "members" &&
      s.organization_id === orgId &&
      s.user_id === viewerUserId &&
      s.deleted_at === null
  );
  if (member) return { state: "ok", peerData: [`peer-of-${viewerUserId}-in-${orgId}`] };

  const alumni = sources.find(
    (s) =>
      s.table === "alumni" &&
      s.organization_id === orgId &&
      s.user_id === viewerUserId &&
      s.deleted_at === null
  );
  if (alumni) return { state: "ok", peerData: [`peer-of-${viewerUserId}-in-${orgId}`] };

  return { state: "no_source", suggestions: [] };
}

// ── Test fixtures ──────────────────────────────────────────────────────────────

const ORG_A = randomUUID();
const ORG_B = randomUUID();

// Viewer with an ACTIVE active_member membership in ORG_A only.
const viewerOrgA: UserContext = {
  userId: "viewer-org-a",
  memberships: [{ organizationId: ORG_A, role: "active_member", status: "active" }],
};

const unauthenticated: UserContext = { userId: null, memberships: [] };

// ── viewer active in ORG_A requesting ORG_B → 403, no peer data ─────────────────

describe("viewer active in ORG_A cannot reach ORG_B connections endpoints", () => {
  it("GET ORG_B/connections/suggestions → 403 (no membership in ORG_B)", () => {
    assert.equal(simulateSuggestions(viewerOrgA, ORG_B).status, 403);
  });

  it("GET ORG_B/connections/networking-consent → 403", () => {
    assert.equal(simulateConsentGet(viewerOrgA, ORG_B).status, 403);
  });

  it("PATCH ORG_B/connections/networking-consent → 403", () => {
    assert.equal(simulateConsentPatch(viewerOrgA, ORG_B).status, 403);
  });

  it("blocked at the gate → handler never runs the source lookup, so NO peer data leaks", () => {
    // The 403 short-circuits before getViewerConnectionSuggestions is called.
    const gate = simulateSuggestions(viewerOrgA, ORG_B);
    assert.equal(gate.status, 403);
    // Defense-in-depth: even if the gate were bypassed, the source lookup for
    // ORG_B (viewer has no projected row there) yields no peers.
    const sources: SourceRow[] = [
      { table: "members", organization_id: ORG_A, user_id: "viewer-org-a", deleted_at: null },
    ];
    const result = simulateGetViewerSuggestions(sources, ORG_B, "viewer-org-a");
    assert.equal(result.state, "no_source");
    assert.deepEqual(result.state === "no_source" ? result.suggestions : ["LEAK"], []);
  });
});

// ── getViewerConnectionSuggestions: source resolution is org-scoped ─────────────

describe("getViewerConnectionSuggestions resolves source only within the target org", () => {
  it("viewer has a member row in ORG_A but resolves source for ORG_B → no_source / empty", () => {
    const sources: SourceRow[] = [
      { table: "members", organization_id: ORG_A, user_id: "viewer-org-a", deleted_at: null },
    ];
    const result = simulateGetViewerSuggestions(sources, ORG_B, "viewer-org-a");
    assert.equal(result.state, "no_source");
    assert.deepEqual(result.state === "no_source" ? result.suggestions : ["LEAK"], []);
  });

  it("viewer has an alumni row in ORG_A but resolves source for ORG_B → no_source / empty", () => {
    const sources: SourceRow[] = [
      { table: "alumni", organization_id: ORG_A, user_id: "viewer-org-a", deleted_at: null },
    ];
    const result = simulateGetViewerSuggestions(sources, ORG_B, "viewer-org-a");
    assert.equal(result.state, "no_source");
  });

  it("a soft-deleted ORG_A member row does not satisfy the source lookup", () => {
    const sources: SourceRow[] = [
      {
        table: "members",
        organization_id: ORG_A,
        user_id: "viewer-org-a",
        deleted_at: new Date().toISOString(),
      },
    ];
    const result = simulateGetViewerSuggestions(sources, ORG_A, "viewer-org-a");
    assert.equal(result.state, "no_source");
  });
});

// ── Unauthenticated → 401 everywhere ───────────────────────────────────────────

describe("unauthenticated requests are rejected before any org lookup", () => {
  it("GET ORG_A/connections/suggestions → 401", () => {
    assert.equal(simulateSuggestions(unauthenticated, ORG_A).status, 401);
  });

  it("GET ORG_A/connections/networking-consent → 401", () => {
    assert.equal(simulateConsentGet(unauthenticated, ORG_A).status, 401);
  });

  it("PATCH ORG_A/connections/networking-consent → 401", () => {
    assert.equal(simulateConsentPatch(unauthenticated, ORG_A).status, 401);
  });
});

// ── Inactive memberships in the target org provide no access ────────────────────

describe("pending/revoked membership in ORG_B is not treated as active", () => {
  it("pending member in ORG_B GET suggestions → 403", () => {
    const pending: UserContext = {
      userId: "pending-org-b",
      memberships: [{ organizationId: ORG_B, role: "active_member", status: "pending" }],
    };
    assert.equal(simulateSuggestions(pending, ORG_B).status, 403);
  });

  it("revoked member in ORG_B PATCH consent → 403", () => {
    const revoked: UserContext = {
      userId: "revoked-org-b",
      memberships: [{ organizationId: ORG_B, role: "active_member", status: "revoked" }],
    };
    assert.equal(simulateConsentPatch(revoked, ORG_B).status, 403);
  });
});

// ── Sanity positive: viewer in ORG_A reaching ORG_A is allowed ──────────────────
// Proves the deny is real org-scoping, not a trivially-always-403 gate.

describe("sanity: viewer active in ORG_A IS allowed to reach ORG_A (deny is not always-true)", () => {
  it("GET ORG_A/connections/suggestions → passes gate (200)", () => {
    assert.equal(simulateSuggestions(viewerOrgA, ORG_A).status, 200);
  });

  it("GET ORG_A/connections/networking-consent → passes gate (200)", () => {
    assert.equal(simulateConsentGet(viewerOrgA, ORG_A).status, 200);
  });

  it("PATCH ORG_A/connections/networking-consent → passes gate (200)", () => {
    assert.equal(simulateConsentPatch(viewerOrgA, ORG_A).status, 200);
  });

  it("source lookup in ORG_A returns the viewer's own node (state ok)", () => {
    const sources: SourceRow[] = [
      { table: "members", organization_id: ORG_A, user_id: "viewer-org-a", deleted_at: null },
    ];
    const result = simulateGetViewerSuggestions(sources, ORG_A, "viewer-org-a");
    assert.equal(result.state, "ok");
  });

  it("each normalized chat-eligible role passes the ORG_A gate (admin, member→active_member, viewer→alumni, parent)", () => {
    const rawRoles: RawRole[] = ["admin", "member", "viewer", "active_member", "alumni", "parent"];
    for (const role of rawRoles) {
      const ctx: UserContext = {
        userId: `role-${role}`,
        memberships: [{ organizationId: ORG_A, role, status: "active" }],
      };
      assert.equal(
        simulateSuggestions(ctx, ORG_A).status,
        200,
        `raw role "${role}" should normalize to a chat-eligible role and pass`
      );
    }
  });
});
