/**
 * Grace Period Utilities
 * 
 * Handles the 30-day grace period after subscription cancellation.
 * During grace period, organizations have read-only access.
 * After grace period expires, the organization is auto-deleted.
 */

export const GRACE_PERIOD_DAYS = 30;

export interface GracePeriodInfo {
  /** Whether the organization is in a grace period (subscription canceled but not yet deleted) */
  isInGracePeriod: boolean;
  /** Whether the grace period has expired (org should be deleted) */
  isGracePeriodExpired: boolean;
  /** Days remaining in the grace period (0 if not in grace period or expired) */
  daysRemaining: number;
  /** The date when the grace period ends */
  gracePeriodEndsAt: Date | null;
  /** Whether the subscription is actively canceling (scheduled but not yet canceled) */
  isCanceling: boolean;
  /** Whether the subscription is fully canceled */
  isCanceled: boolean;
  /** Whether the org should have read-only access */
  isReadOnly: boolean;
}

export interface SubscriptionStatus {
  status: string | null;
  gracePeriodEndsAt: string | null;
  currentPeriodEnd: string | null;
}

/**
 * Calculate grace period information from subscription status
 */
export function getGracePeriodInfo(subscription: SubscriptionStatus | null): GracePeriodInfo {
  if (!subscription) {
    return {
      isInGracePeriod: false,
      isGracePeriodExpired: false,
      daysRemaining: 0,
      gracePeriodEndsAt: null,
      isCanceling: false,
      isCanceled: false,
      isReadOnly: false,
    };
  }

  const { status, gracePeriodEndsAt } = subscription;
  const isCanceling = status === "canceling";
  const isCanceled = status === "canceled";
  
  // Parse grace period end date
  const gracePeriodDate = gracePeriodEndsAt ? new Date(gracePeriodEndsAt) : null;
  const now = new Date();
  
  // Calculate if in grace period and days remaining
  let isInGracePeriod = false;
  let isGracePeriodExpired = false;
  let daysRemaining = 0;
  
  if (isCanceled) {
    if (gracePeriodDate) {
      if (now < gracePeriodDate) {
        isInGracePeriod = true;
        daysRemaining = Math.ceil((gracePeriodDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      } else {
        isGracePeriodExpired = true;
      }
    } else {
      // Canceled but no grace period set (legacy data or webhook issue)
      // Treat as expired to be safe - admin should resubscribe or delete
      isGracePeriodExpired = true;
    }
  }
  
  // Organization is read-only during grace period
  const isReadOnly = isInGracePeriod;
  
  return {
    isInGracePeriod,
    isGracePeriodExpired,
    daysRemaining,
    gracePeriodEndsAt: gracePeriodDate,
    isCanceling,
    isCanceled,
    isReadOnly,
  };
}

/**
 * Calculate the grace period end date (30 days from now)
 */
export function calculateGracePeriodEnd(): string {
  const date = new Date();
  date.setDate(date.getDate() + GRACE_PERIOD_DAYS);
  return date.toISOString();
}

/**
 * Format the grace period end date for display
 */
export function formatGracePeriodDate(date: Date | string | null): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Check if a subscription status indicates the org should be blocked from access
 * (not active, not canceling, not in grace period)
 */
export function shouldBlockAccess(subscription: SubscriptionStatus | null): boolean {
  if (!subscription) return true;
  
  const activeStatuses = ["active", "trialing", "canceling"];
  if (activeStatuses.includes(subscription.status || "")) {
    return false;
  }
  
  // If canceled, check if still in grace period
  if (subscription.status === "canceled") {
    const info = getGracePeriodInfo(subscription);
    // Block if expired OR if no grace period was set (treat as expired)
    return info.isGracePeriodExpired;
  }
  
  // Block for other statuses (past_due, incomplete, etc.)
  return true;
}

/**
 * Check if organization is in read-only mode (grace period active)
 * Use this to block mutations in API routes
 */
export function isOrgReadOnly(subscription: SubscriptionStatus | null): boolean {
  if (!subscription) return false;
  const info = getGracePeriodInfo(subscription);
  return info.isReadOnly;
}
