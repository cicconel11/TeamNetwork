/**
 * Auth mock utilities for API route testing.
 * Provides typed mock contexts for simulating authenticated users and their org memberships.
 */

export interface MockUser {
  id: string;
  email?: string;
}

export interface MockMembership {
  organization_id: string;
  role: "admin" | "active_member" | "alumni";
  status: "active" | "pending" | "revoked";
}

export interface AuthContext {
  user: MockUser | null;
  memberships: MockMembership[];
}

/**
 * Creates an auth context for testing route handlers.
 *
 * @example
 * const ctx = createAuthContext({
 *   user: { id: "user-123", email: "test@example.com" },
 *   memberships: [{ organization_id: "org-1", role: "admin", status: "active" }]
 * });
 */
export function createAuthContext(options: {
  user?: MockUser | null;
  memberships?: MockMembership[];
} = {}): AuthContext {
  return {
    user: options.user ?? null,
    memberships: options.memberships ?? [],
  };
}

/**
 * Checks if the user is authenticated.
 */
export function isAuthenticated(ctx: AuthContext): boolean {
  return ctx.user !== null && ctx.user.id !== "";
}

/**
 * Checks if the user has an active membership in the given organization.
 */
export function hasOrgMembership(ctx: AuthContext, organizationId: string): boolean {
  return ctx.memberships.some(
    (m) => m.organization_id === organizationId && m.status === "active"
  );
}

/**
 * Checks if the user has admin role in the given organization.
 */
export function isOrgAdmin(ctx: AuthContext, organizationId: string): boolean {
  return ctx.memberships.some(
    (m) =>
      m.organization_id === organizationId &&
      m.role === "admin" &&
      m.status === "active"
  );
}

/**
 * Gets the user's role in the given organization, or null if not a member.
 */
export function getOrgRole(
  ctx: AuthContext,
  organizationId: string
): MockMembership["role"] | null {
  const membership = ctx.memberships.find(
    (m) => m.organization_id === organizationId && m.status === "active"
  );
  return membership?.role ?? null;
}

/**
 * Checks if the user has a revoked membership in the given organization.
 */
export function isRevoked(ctx: AuthContext, organizationId: string): boolean {
  return ctx.memberships.some(
    (m) => m.organization_id === organizationId && m.status === "revoked"
  );
}

/**
 * Preset auth contexts for common test scenarios.
 */
export const AuthPresets = {
  /** No user (unauthenticated) */
  unauthenticated: createAuthContext(),

  /** Authenticated user with no org memberships */
  authenticatedNoOrg: createAuthContext({
    user: { id: "user-123", email: "user@example.com" },
    memberships: [],
  }),

  /** Admin user in org-1 */
  orgAdmin: (orgId: string = "org-1") =>
    createAuthContext({
      user: { id: "admin-user", email: "admin@example.com" },
      memberships: [{ organization_id: orgId, role: "admin", status: "active" }],
    }),

  /** Active member in org-1 */
  orgMember: (orgId: string = "org-1") =>
    createAuthContext({
      user: { id: "member-user", email: "member@example.com" },
      memberships: [{ organization_id: orgId, role: "active_member", status: "active" }],
    }),

  /** Alumni member in org-1 */
  orgAlumni: (orgId: string = "org-1") =>
    createAuthContext({
      user: { id: "alumni-user", email: "alumni@example.com" },
      memberships: [{ organization_id: orgId, role: "alumni", status: "active" }],
    }),

  /** Revoked user in org-1 */
  revokedUser: (orgId: string = "org-1") =>
    createAuthContext({
      user: { id: "revoked-user", email: "revoked@example.com" },
      memberships: [{ organization_id: orgId, role: "active_member", status: "revoked" }],
    }),

  /** Pending member in org-1 */
  pendingMember: (orgId: string = "org-1") =>
    createAuthContext({
      user: { id: "pending-user", email: "pending@example.com" },
      memberships: [{ organization_id: orgId, role: "active_member", status: "pending" }],
    }),
};
