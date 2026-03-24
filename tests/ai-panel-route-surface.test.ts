import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { routeToSurface } from "../src/components/ai-assistant/route-surface";

describe("routeToSurface", () => {
  describe("members surface", () => {
    it("maps /members to members", () => {
      assert.equal(routeToSurface("/my-org/members"), "members");
    });

    it("maps /alumni to members", () => {
      assert.equal(routeToSurface("/my-org/alumni"), "members");
    });

    it("maps /parents to members", () => {
      assert.equal(routeToSurface("/my-org/parents"), "members");
    });

    it("maps /mentorship to members", () => {
      assert.equal(routeToSurface("/my-org/mentorship"), "members");
    });

    it("maps nested members route", () => {
      assert.equal(routeToSurface("/my-org/members/abc-123"), "members");
    });
  });

  describe("events surface", () => {
    it("maps /events to events", () => {
      assert.equal(routeToSurface("/my-org/events"), "events");
    });

    it("maps /calendar to events", () => {
      assert.equal(routeToSurface("/my-org/calendar"), "events");
    });

    it("maps nested events route", () => {
      assert.equal(routeToSurface("/my-org/events/upcoming/details"), "events");
    });
  });

  describe("analytics surface", () => {
    it("maps /philanthropy to analytics", () => {
      assert.equal(routeToSurface("/my-org/philanthropy"), "analytics");
    });

    it("maps /donations to analytics", () => {
      assert.equal(routeToSurface("/my-org/donations"), "analytics");
    });

    it("maps /expenses to analytics", () => {
      assert.equal(routeToSurface("/my-org/expenses"), "analytics");
    });

    it("maps /analytics to analytics", () => {
      assert.equal(routeToSurface("/my-org/analytics"), "analytics");
    });

    it("maps nested analytics route", () => {
      assert.equal(routeToSurface("/my-org/philanthropy/campaigns/42"), "analytics");
    });
  });

  describe("general surface (default)", () => {
    it("returns general for org home", () => {
      assert.equal(routeToSurface("/my-org"), "general");
    });

    it("returns general for unmapped segments", () => {
      assert.equal(routeToSurface("/my-org/announcements"), "general");
    });

    it("returns general for feed", () => {
      assert.equal(routeToSurface("/my-org/feed"), "general");
    });

    it("returns general for workouts", () => {
      assert.equal(routeToSurface("/my-org/workouts"), "general");
    });

    it("returns general for chat", () => {
      assert.equal(routeToSurface("/my-org/chat"), "general");
    });

    it("returns general for root path", () => {
      assert.equal(routeToSurface("/"), "general");
    });

    it("returns general for empty string", () => {
      assert.equal(routeToSurface(""), "general");
    });
  });

  describe("edge cases", () => {
    it("handles trailing slash", () => {
      assert.equal(routeToSurface("/my-org/members/"), "members");
    });

    it("handles query params", () => {
      assert.equal(routeToSurface("/my-org/events?tab=past"), "events");
    });

    it("handles hash fragments", () => {
      assert.equal(routeToSurface("/my-org/analytics#revenue"), "analytics");
    });

    it("handles org slugs with hyphens", () => {
      assert.equal(routeToSurface("/alpha-beta-gamma/members"), "members");
    });

    it("does not match partial segment names", () => {
      // "/membership" should NOT match "/members"
      assert.equal(routeToSurface("/my-org/membership"), "general");
    });

    it("handles org slug only with trailing slash", () => {
      assert.equal(routeToSurface("/my-org/"), "general");
    });
  });
});
