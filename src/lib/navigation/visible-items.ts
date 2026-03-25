import type { OrgRole } from "@/lib/auth/role-utils";
import { ORG_NAV_ITEMS, getConfigKey, type NavConfig, type OrgNavItem } from "./nav-items";

interface GetVisibleOrgNavItemsInput {
  role: OrgRole | null;
  hasAlumniAccess?: boolean;
  hasParentsAccess?: boolean;
  navConfig?: NavConfig | null;
}

export function getVisibleOrgNavItems({
  role,
  hasAlumniAccess = false,
  hasParentsAccess = false,
  navConfig,
}: GetVisibleOrgNavItemsInput): OrgNavItem[] {
  const resolvedNavConfig = navConfig ?? {};

  return ORG_NAV_ITEMS.filter((item) => {
    if (role && !item.roles.includes(role)) {
      return false;
    }

    if (item.requiresAlumni && !hasAlumniAccess) {
      return false;
    }

    if (item.requiresParents && !hasParentsAccess) {
      return false;
    }

    const configKey = getConfigKey(item.href);
    const config = resolvedNavConfig[configKey];

    if (config?.hidden) {
      return false;
    }

    if (
      role &&
      Array.isArray(config?.hiddenForRoles) &&
      config.hiddenForRoles.includes(role)
    ) {
      return false;
    }

    return true;
  });
}
