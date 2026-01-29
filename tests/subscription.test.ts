/**
 * Consolidated Subscription Tests
 *
 * Tests for subscription lifecycle including:
 * - Cancel subscription flow
 * - Resume subscription flow
 * - Grace period handling
 * - Access control based on subscription status
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  getGracePeriodInfo,
  calculateGracePeriodEnd,
  shouldBlockAccess,
  isOrgReadOnly,
  GRACE_PERIOD_DAYS,
  type SubscriptionStatus,
} from "../src/lib/subscription/grace-period.ts";

// Mock types for cancel/resume testing
interface MockSubscription {
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
}

interface CancelSubscriptionRequest {
  organizationId: string;
  userId: string;
  userRole: string;
  subscription: MockSubscription | null;
}

interface CancelSubscriptionResult {
  success: boolean;
  status?: string;
  currentPeriodEnd?: string;
  error?: string;
}

interface ResumeSubscriptionRequest {
  organizationId: string;
  userId: string;
  userRole: string;
  subscription: MockSubscription | null;
}

interface ResumeSubscriptionResult {
  success: boolean;
  status?: string;
  error?: string;
}

// Simulates the cancel subscription logic (schedules cancellation at period end)
function simulateCancelSubscription(request: CancelSubscriptionRequest): CancelSubscriptionResult {
  // Check authentication
  if (!request.userId) {
    return { success: false, error: "Unauthorized" };
  }

  // Check authorization - must be admin
  if (request.userRole !== "admin") {
    return { success: false, error: "Forbidden" };
  }

  // Check subscription exists
  if (!request.subscription) {
    return { success: false, error: "Subscription not found" };
  }

  // Schedule cancellation at period end (in real code this calls Stripe with cancel_at_period_end: true)
  // Update status to "canceling" (not "canceled" - subscription is still active until period end)
  return {
    success: true,
    status: "canceling",
    currentPeriodEnd: request.subscription.current_period_end || undefined,
  };
}

// Simulates the resume subscription logic (removes scheduled cancellation)
function simulateResumeSubscription(request: ResumeSubscriptionRequest): ResumeSubscriptionResult {
  // Check authentication
  if (!request.userId) {
    return { success: false, error: "Unauthorized" };
  }

  // Check authorization - must be admin
  if (request.userRole !== "admin") {
    return { success: false, error: "Forbidden" };
  }

  // Check subscription exists
  if (!request.subscription) {
    return { success: false, error: "Subscription not found" };
  }

  // Can only resume a subscription that is scheduled for cancellation
  if (request.subscription.status !== "canceling") {
    return { success: false, error: "Subscription is not scheduled for cancellation" };
  }

  // Must have a Stripe subscription to resume
  if (!request.subscription.stripe_subscription_id) {
    return { success: false, error: "No Stripe subscription to resume" };
  }

  // Resume the subscription (in real code this calls Stripe with cancel_at_period_end: false)
  // Update status back to "active"
  return { success: true, status: "active" };
}

describe("Subscription Lifecycle", () => {
  describe("Cancel Subscription", () => {
    it("should require authentication", () => {
      const result = simulateCancelSubscription({
        organizationId: "org-123",
        userId: "", // No user
        userRole: "admin",
        subscription: { stripe_subscription_id: "sub_123", status: "active", current_period_end: "2025-02-09T00:00:00Z" },
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "Unauthorized");
    });

    it("should require admin role", () => {
      const result = simulateCancelSubscription({
        organizationId: "org-123",
        userId: "user-123",
        userRole: "active_member", // Not admin
        subscription: { stripe_subscription_id: "sub_123", status: "active", current_period_end: "2025-02-09T00:00:00Z" },
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "Forbidden");
    });

    it("should fail when no subscription exists", () => {
      const result = simulateCancelSubscription({
        organizationId: "org-123",
        userId: "user-123",
        userRole: "admin",
        subscription: null, // No subscription
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "Subscription not found");
    });

    it("should schedule cancellation at period end for admin", () => {
      const periodEnd = "2025-02-09T00:00:00Z";
      const result = simulateCancelSubscription({
        organizationId: "org-123",
        userId: "user-123",
        userRole: "admin",
        subscription: { stripe_subscription_id: "sub_123", status: "active", current_period_end: periodEnd },
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, "canceling"); // Not "canceled" - still active until period end
      assert.strictEqual(result.currentPeriodEnd, periodEnd);
    });

    it("should work even without stripe_subscription_id", () => {
      // Edge case: subscription record exists but no Stripe sub ID
      // (e.g., checkout was never completed)
      const result = simulateCancelSubscription({
        organizationId: "org-123",
        userId: "user-123",
        userRole: "admin",
        subscription: { stripe_subscription_id: null, status: "pending", current_period_end: null },
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, "canceling");
    });
  });

  describe("Resume Subscription", () => {
    it("should require authentication", () => {
      const result = simulateResumeSubscription({
        organizationId: "org-123",
        userId: "", // No user
        userRole: "admin",
        subscription: { stripe_subscription_id: "sub_123", status: "canceling", current_period_end: "2025-02-09T00:00:00Z" },
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "Unauthorized");
    });

    it("should require admin role", () => {
      const result = simulateResumeSubscription({
        organizationId: "org-123",
        userId: "user-123",
        userRole: "active_member", // Not admin
        subscription: { stripe_subscription_id: "sub_123", status: "canceling", current_period_end: "2025-02-09T00:00:00Z" },
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "Forbidden");
    });

    it("should fail when no subscription exists", () => {
      const result = simulateResumeSubscription({
        organizationId: "org-123",
        userId: "user-123",
        userRole: "admin",
        subscription: null, // No subscription
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "Subscription not found");
    });

    it("should fail when subscription is not scheduled for cancellation", () => {
      const result = simulateResumeSubscription({
        organizationId: "org-123",
        userId: "user-123",
        userRole: "admin",
        subscription: { stripe_subscription_id: "sub_123", status: "active", current_period_end: "2025-02-09T00:00:00Z" },
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "Subscription is not scheduled for cancellation");
    });

    it("should fail without stripe_subscription_id", () => {
      const result = simulateResumeSubscription({
        organizationId: "org-123",
        userId: "user-123",
        userRole: "admin",
        subscription: { stripe_subscription_id: null, status: "canceling", current_period_end: null },
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "No Stripe subscription to resume");
    });

    it("should succeed for admin with canceling subscription", () => {
      const result = simulateResumeSubscription({
        organizationId: "org-123",
        userId: "user-123",
        userRole: "admin",
        subscription: { stripe_subscription_id: "sub_123", status: "canceling", current_period_end: "2025-02-09T00:00:00Z" },
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, "active");
    });
  });

  describe("Grace Period Utilities", () => {
    describe("getGracePeriodInfo", () => {
      it("should return default values for null subscription", () => {
        const result = getGracePeriodInfo(null);
        assert.strictEqual(result.isInGracePeriod, false);
        assert.strictEqual(result.isGracePeriodExpired, false);
        assert.strictEqual(result.daysRemaining, 0);
        assert.strictEqual(result.gracePeriodEndsAt, null);
        assert.strictEqual(result.isCanceling, false);
        assert.strictEqual(result.isCanceled, false);
        assert.strictEqual(result.isReadOnly, false);
      });

      it("should detect canceling status", () => {
        const subscription: SubscriptionStatus = {
          status: "canceling",
          gracePeriodEndsAt: null,
          currentPeriodEnd: new Date().toISOString(),
        };
        const result = getGracePeriodInfo(subscription);
        assert.strictEqual(result.isCanceling, true);
        assert.strictEqual(result.isCanceled, false);
        assert.strictEqual(result.isInGracePeriod, false);
      });

      it("should detect active grace period", () => {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 15);

        const subscription: SubscriptionStatus = {
          status: "canceled",
          gracePeriodEndsAt: futureDate.toISOString(),
          currentPeriodEnd: new Date().toISOString(),
        };
        const result = getGracePeriodInfo(subscription);

        assert.strictEqual(result.isCanceled, true);
        assert.strictEqual(result.isInGracePeriod, true);
        assert.strictEqual(result.isGracePeriodExpired, false);
        assert.strictEqual(result.isReadOnly, true);
        assert.ok(result.daysRemaining >= 14 && result.daysRemaining <= 16);
      });

      it("should detect expired grace period", () => {
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 5);

        const subscription: SubscriptionStatus = {
          status: "canceled",
          gracePeriodEndsAt: pastDate.toISOString(),
          currentPeriodEnd: new Date().toISOString(),
        };
        const result = getGracePeriodInfo(subscription);

        assert.strictEqual(result.isCanceled, true);
        assert.strictEqual(result.isInGracePeriod, false);
        assert.strictEqual(result.isGracePeriodExpired, true);
        assert.strictEqual(result.daysRemaining, 0);
      });

      it("should treat canceled with null grace period as expired", () => {
        const subscription: SubscriptionStatus = {
          status: "canceled",
          gracePeriodEndsAt: null,
          currentPeriodEnd: new Date().toISOString(),
        };
        const result = getGracePeriodInfo(subscription);

        assert.strictEqual(result.isCanceled, true);
        assert.strictEqual(result.isInGracePeriod, false);
        assert.strictEqual(result.isGracePeriodExpired, true);
      });
    });

    describe("calculateGracePeriodEnd", () => {
      it("should return a date 30 days in the future", () => {
        const result = calculateGracePeriodEnd();
        const resultDate = new Date(result);
        const now = new Date();

        const diffDays = Math.round((resultDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        assert.strictEqual(diffDays, GRACE_PERIOD_DAYS);
      });
    });

    describe("shouldBlockAccess", () => {
      it("should block access for null subscription", () => {
        assert.strictEqual(shouldBlockAccess(null), true);
      });

      it("should allow access for active subscription", () => {
        const subscription: SubscriptionStatus = {
          status: "active",
          gracePeriodEndsAt: null,
          currentPeriodEnd: new Date().toISOString(),
        };
        assert.strictEqual(shouldBlockAccess(subscription), false);
      });

      it("should allow access for trialing subscription", () => {
        const subscription: SubscriptionStatus = {
          status: "trialing",
          gracePeriodEndsAt: null,
          currentPeriodEnd: new Date().toISOString(),
        };
        assert.strictEqual(shouldBlockAccess(subscription), false);
      });

      it("should allow access for canceling subscription", () => {
        const subscription: SubscriptionStatus = {
          status: "canceling",
          gracePeriodEndsAt: null,
          currentPeriodEnd: new Date().toISOString(),
        };
        assert.strictEqual(shouldBlockAccess(subscription), false);
      });

      it("should allow access for canceled subscription in grace period", () => {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 15);

        const subscription: SubscriptionStatus = {
          status: "canceled",
          gracePeriodEndsAt: futureDate.toISOString(),
          currentPeriodEnd: new Date().toISOString(),
        };
        assert.strictEqual(shouldBlockAccess(subscription), false);
      });

      it("should block access for canceled subscription with expired grace period", () => {
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 5);

        const subscription: SubscriptionStatus = {
          status: "canceled",
          gracePeriodEndsAt: pastDate.toISOString(),
          currentPeriodEnd: new Date().toISOString(),
        };
        assert.strictEqual(shouldBlockAccess(subscription), true);
      });

      it("should block access for canceled subscription with null grace period", () => {
        const subscription: SubscriptionStatus = {
          status: "canceled",
          gracePeriodEndsAt: null,
          currentPeriodEnd: new Date().toISOString(),
        };
        assert.strictEqual(shouldBlockAccess(subscription), true);
      });

      it("should block access for past_due subscription", () => {
        const subscription: SubscriptionStatus = {
          status: "past_due",
          gracePeriodEndsAt: null,
          currentPeriodEnd: new Date().toISOString(),
        };
        assert.strictEqual(shouldBlockAccess(subscription), true);
      });
    });

    describe("isOrgReadOnly", () => {
      it("should return false for null subscription", () => {
        assert.strictEqual(isOrgReadOnly(null), false);
      });

      it("should return false for active subscription", () => {
        const subscription: SubscriptionStatus = {
          status: "active",
          gracePeriodEndsAt: null,
          currentPeriodEnd: new Date().toISOString(),
        };
        assert.strictEqual(isOrgReadOnly(subscription), false);
      });

      it("should return true for canceled subscription in grace period", () => {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 15);

        const subscription: SubscriptionStatus = {
          status: "canceled",
          gracePeriodEndsAt: futureDate.toISOString(),
          currentPeriodEnd: new Date().toISOString(),
        };
        assert.strictEqual(isOrgReadOnly(subscription), true);
      });

      it("should return false for canceled subscription with expired grace period", () => {
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 5);

        const subscription: SubscriptionStatus = {
          status: "canceled",
          gracePeriodEndsAt: pastDate.toISOString(),
          currentPeriodEnd: new Date().toISOString(),
        };
        assert.strictEqual(isOrgReadOnly(subscription), false);
      });
    });
  });
});
