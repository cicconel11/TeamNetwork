/**
 * Dev admin mock utilities for API route testing.
 * Simulates the dev admin permission system for routes that support it.
 */

export type DevAdminAction =
  | "delete_org"
  | "view_all_orgs"
  | "impersonate_user"
  | "access_billing_portal";

export interface DevAdminContext {
  isDevAdmin: boolean;
  allowedActions?: DevAdminAction[];
}

/**
 * Check if the user can perform a dev admin action.
 */
export function canDevAdminPerform(
  ctx: DevAdminContext,
  action: DevAdminAction
): boolean {
  if (!ctx.isDevAdmin) return false;
  if (!ctx.allowedActions) return true; // Full dev admin access
  return ctx.allowedActions.includes(action);
}

/**
 * Preset dev admin contexts for common test scenarios.
 */
export const DevAdminPresets = {
  /** Not a dev admin */
  notDevAdmin: (): DevAdminContext => ({
    isDevAdmin: false,
  }),

  /** Full dev admin access */
  fullAccess: (): DevAdminContext => ({
    isDevAdmin: true,
  }),

  /** Dev admin with limited actions */
  limitedAccess: (actions: DevAdminAction[]): DevAdminContext => ({
    isDevAdmin: true,
    allowedActions: actions,
  }),

  /** Dev admin that can only delete orgs */
  deleteOrgOnly: (): DevAdminContext => ({
    isDevAdmin: true,
    allowedActions: ["delete_org"],
  }),

  /** Dev admin that can view all orgs */
  viewOrgsOnly: (): DevAdminContext => ({
    isDevAdmin: true,
    allowedActions: ["view_all_orgs"],
  }),
};
