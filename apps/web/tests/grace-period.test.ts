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

describe("Grace Period Utilities", () => {
  describe("getGracePeriodInfo", () => {
    it("returns default values for null subscription", () => {
      const result = getGracePeriodInfo(null);
      assert.strictEqual(result.isInGracePeriod, false);
      assert.strictEqual(result.isGracePeriodExpired, false);
      assert.strictEqual(result.daysRemaining, 0);
      assert.strictEqual(result.gracePeriodEndsAt, null);
      assert.strictEqual(result.isCanceling, false);
      assert.strictEqual(result.isCanceled, false);
      assert.strictEqual(result.isReadOnly, false);
    });

    it("detects canceling status", () => {
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

    it("detects active grace period", () => {
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

    it("detects expired grace period", () => {
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

    it("treats canceled with null grace period as expired", () => {
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
    it("returns a date 30 days in the future", () => {
      const result = calculateGracePeriodEnd();
      const resultDate = new Date(result);
      const now = new Date();

      const diffDays = Math.round((resultDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      assert.strictEqual(diffDays, GRACE_PERIOD_DAYS);
    });
  });

  describe("shouldBlockAccess", () => {
    it("blocks access for null subscription", () => {
      assert.strictEqual(shouldBlockAccess(null), true);
    });

    it("allows access for active subscription", () => {
      const subscription: SubscriptionStatus = {
        status: "active",
        gracePeriodEndsAt: null,
        currentPeriodEnd: new Date().toISOString(),
      };
      assert.strictEqual(shouldBlockAccess(subscription), false);
    });

    it("allows access for trialing subscription", () => {
      const subscription: SubscriptionStatus = {
        status: "trialing",
        gracePeriodEndsAt: null,
        currentPeriodEnd: new Date().toISOString(),
      };
      assert.strictEqual(shouldBlockAccess(subscription), false);
    });

    it("allows access for canceling subscription", () => {
      const subscription: SubscriptionStatus = {
        status: "canceling",
        gracePeriodEndsAt: null,
        currentPeriodEnd: new Date().toISOString(),
      };
      assert.strictEqual(shouldBlockAccess(subscription), false);
    });

    it("allows access for canceled subscription in grace period", () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 15);

      const subscription: SubscriptionStatus = {
        status: "canceled",
        gracePeriodEndsAt: futureDate.toISOString(),
        currentPeriodEnd: new Date().toISOString(),
      };
      assert.strictEqual(shouldBlockAccess(subscription), false);
    });

    it("blocks access for canceled subscription with expired grace period", () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);

      const subscription: SubscriptionStatus = {
        status: "canceled",
        gracePeriodEndsAt: pastDate.toISOString(),
        currentPeriodEnd: new Date().toISOString(),
      };
      assert.strictEqual(shouldBlockAccess(subscription), true);
    });

    it("blocks access for canceled subscription with null grace period", () => {
      const subscription: SubscriptionStatus = {
        status: "canceled",
        gracePeriodEndsAt: null,
        currentPeriodEnd: new Date().toISOString(),
      };
      assert.strictEqual(shouldBlockAccess(subscription), true);
    });

    it("blocks access for past_due subscription", () => {
      const subscription: SubscriptionStatus = {
        status: "past_due",
        gracePeriodEndsAt: null,
        currentPeriodEnd: new Date().toISOString(),
      };
      assert.strictEqual(shouldBlockAccess(subscription), true);
    });
  });

  describe("isOrgReadOnly", () => {
    it("returns false for null subscription", () => {
      assert.strictEqual(isOrgReadOnly(null), false);
    });

    it("returns false for active subscription", () => {
      const subscription: SubscriptionStatus = {
        status: "active",
        gracePeriodEndsAt: null,
        currentPeriodEnd: new Date().toISOString(),
      };
      assert.strictEqual(isOrgReadOnly(subscription), false);
    });

    it("returns true for canceled subscription in grace period", () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 15);

      const subscription: SubscriptionStatus = {
        status: "canceled",
        gracePeriodEndsAt: futureDate.toISOString(),
        currentPeriodEnd: new Date().toISOString(),
      };
      assert.strictEqual(isOrgReadOnly(subscription), true);
    });

    it("returns false for canceled subscription with expired grace period", () => {
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
