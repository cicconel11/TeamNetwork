import type { OrgRole } from "@/lib/auth/role-utils";
import { ONBOARDING_ITEMS, type OnboardingItem } from "./items";

interface GetVisibleOnboardingItemsInput {
  role: OrgRole | null;
  hasAlumniAccess?: boolean;
  hasParentsAccess?: boolean;
}

/** Max items shown in the checklist at once. */
const MAX_CHECKLIST_ITEMS = 8;

/**
 * Returns the subset of ONBOARDING_ITEMS visible to a given user,
 * capped at MAX_CHECKLIST_ITEMS. Mirrors getVisibleOrgNavItems logic.
 */
export function getVisibleOnboardingItems({
  role,
  hasAlumniAccess = false,
  hasParentsAccess = false,
}: GetVisibleOnboardingItemsInput): readonly OnboardingItem[] {
  const filtered = ONBOARDING_ITEMS.filter((item) => {
    // Universal items (empty roles array) are always included when role is known
    if (item.roles.length > 0 && role && !item.roles.includes(role)) {
      return false;
    }

    if (item.requiresAlumniAccess && !hasAlumniAccess) {
      return false;
    }

    if (item.requiresParentsAccess && !hasParentsAccess) {
      return false;
    }

    return true;
  });

  return filtered.slice(0, MAX_CHECKLIST_ITEMS);
}
