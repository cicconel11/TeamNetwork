import type { UserRole } from "@teammeet/types";

/**
 * Normalized organization role type.
 * Used throughout the app after normalizing from database UserRole.
 */
export type OrgRole = "admin" | "active_member" | "alumni";

/**
 * Normalizes a database UserRole to a simplified OrgRole.
 * - "member" → "active_member"
 * - "viewer" → "alumni"
 * - null/undefined → null
 */
export function normalizeRole(role?: UserRole | null): OrgRole | null {
  if (!role) return null;
  if (role === "member") return "active_member";
  if (role === "viewer") return "alumni";
  if (role === "admin" || role === "active_member" || role === "alumni") {
    return role;
  }
  return null;
}

/**
 * Returns boolean flags for common role checks.
 */
export function roleFlags(role: OrgRole | null) {
  return {
    role,
    isAdmin: role === "admin",
    isActiveMember: role === "active_member",
    isAlumni: role === "alumni",
  };
}
