import type { OrgRole } from "@/lib/auth/role-utils";

/**
 * Determines if a user can edit organization settings based on their role.
 * Requirements 1.1, 1.2: Only admins can edit organization name.
 */
export function canEditOrgName(role: OrgRole | null): boolean {
    return role === "admin";
}
