import type { OrgRole } from "@/lib/auth/role-utils";
import type { NavConfig } from "./nav-items";

export function getNavEditRoles(navConfig: NavConfig | null | undefined, href: string, fallback: OrgRole[] = ["admin"]) {
  const configEntry = navConfig && typeof navConfig === "object" ? (navConfig as NavConfig)[href] : undefined;
  const roles = Array.isArray(configEntry?.editRoles) && configEntry.editRoles.length > 0 ? configEntry.editRoles : fallback;
  // Always ensure admins are allowed
  return Array.from(new Set([...roles, "admin"]));
}

export function canEditNavItem(
  navConfig: NavConfig | null | undefined,
  href: string,
  role: OrgRole | null,
  fallback: OrgRole[] = ["admin"]
) {
  if (!role) return false;
  const allowed = getNavEditRoles(navConfig, href, fallback);
  return allowed.includes(role);
}
