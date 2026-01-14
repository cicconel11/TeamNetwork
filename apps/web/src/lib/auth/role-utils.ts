import type { UserRole } from "@/types/database";

export type OrgRole = "admin" | "active_member" | "alumni";

export function normalizeRole(role?: UserRole | null): OrgRole | null {
  if (!role) return null;
  if (role === "member") return "active_member";
  if (role === "viewer") return "alumni";
  if (role === "admin" || role === "active_member" || role === "alumni") {
    return role;
  }
  return null;
}

export function roleFlags(role: OrgRole | null) {
  return {
    role,
    isAdmin: role === "admin",
    isActiveMember: role === "active_member",
    isAlumni: role === "alumni",
  };
}

