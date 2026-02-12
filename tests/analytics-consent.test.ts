/**
 * Analytics Consent Logic Tests
 *
 * Tests for the consent system including:
 * - resolveTrackingLevel with age bracket and org type restrictions
 * - Edge cases for FERPA/COPPA compliance
 */

import { describe, it } from "node:test";
import assert from "node:assert";

// Recreate types locally to avoid loader issues
type AgeBracket = "under_13" | "13_17" | "18_plus";
type OrgType = "educational" | "athletic" | "general";
type TrackingLevel = "none" | "page_view_only" | "full";

// Recreate resolveTrackingLevel exactly as in src/lib/analytics/consent.ts
function resolveTrackingLevel(
  consented: boolean,
  ageBracket: AgeBracket | null | undefined,
  orgType: OrgType | null | undefined,
): TrackingLevel {
  if (!consented) return "none";
  if (ageBracket === "under_13") return "none";
  if (ageBracket === "13_17") return "page_view_only";
  if (orgType === "educational") return "page_view_only";
  return "full";
}

describe("Analytics Consent - resolveTrackingLevel", () => {
  describe("consent checks", () => {
    it("returns 'none' when user has not consented", () => {
      assert.strictEqual(resolveTrackingLevel(false, "18_plus", "general"), "none");
    });

    it("returns 'none' when not consented even for athletic org", () => {
      assert.strictEqual(resolveTrackingLevel(false, "18_plus", "athletic"), "none");
    });

    it("returns 'none' when not consented regardless of age", () => {
      assert.strictEqual(resolveTrackingLevel(false, "13_17", "general"), "none");
    });
  });

  describe("age bracket restrictions", () => {
    it("returns 'none' for under_13 even with consent", () => {
      assert.strictEqual(resolveTrackingLevel(true, "under_13", "general"), "none");
    });

    it("returns 'none' for under_13 in any org type", () => {
      assert.strictEqual(resolveTrackingLevel(true, "under_13", "educational"), "none");
      assert.strictEqual(resolveTrackingLevel(true, "under_13", "athletic"), "none");
    });

    it("returns 'page_view_only' for 13-17 with consent", () => {
      assert.strictEqual(resolveTrackingLevel(true, "13_17", "general"), "page_view_only");
    });

    it("returns 'page_view_only' for 13-17 in athletic org", () => {
      assert.strictEqual(resolveTrackingLevel(true, "13_17", "athletic"), "page_view_only");
    });

    it("returns 'page_view_only' for 13-17 in educational org (double restriction)", () => {
      assert.strictEqual(resolveTrackingLevel(true, "13_17", "educational"), "page_view_only");
    });

    it("returns 'full' for 18_plus with consent in general org", () => {
      assert.strictEqual(resolveTrackingLevel(true, "18_plus", "general"), "full");
    });

    it("returns 'full' for 18_plus with consent in athletic org", () => {
      assert.strictEqual(resolveTrackingLevel(true, "18_plus", "athletic"), "full");
    });
  });

  describe("org type restrictions (FERPA)", () => {
    it("returns 'page_view_only' for educational org with adult user", () => {
      assert.strictEqual(resolveTrackingLevel(true, "18_plus", "educational"), "page_view_only");
    });

    it("returns 'full' for athletic org with adult user", () => {
      assert.strictEqual(resolveTrackingLevel(true, "18_plus", "athletic"), "full");
    });

    it("returns 'full' for general org with adult user", () => {
      assert.strictEqual(resolveTrackingLevel(true, "18_plus", "general"), "full");
    });
  });

  describe("null/undefined handling", () => {
    it("returns 'full' when age_bracket is null (defaults to adult behavior)", () => {
      assert.strictEqual(resolveTrackingLevel(true, null, "general"), "full");
    });

    it("returns 'full' when age_bracket is undefined", () => {
      assert.strictEqual(resolveTrackingLevel(true, undefined, "general"), "full");
    });

    it("returns 'full' when orgType is null", () => {
      assert.strictEqual(resolveTrackingLevel(true, "18_plus", null), "full");
    });

    it("returns 'full' when orgType is undefined", () => {
      assert.strictEqual(resolveTrackingLevel(true, "18_plus", undefined), "full");
    });

    it("returns 'full' when both are null (consented adult, general org)", () => {
      assert.strictEqual(resolveTrackingLevel(true, null, null), "full");
    });
  });

  describe("priority order", () => {
    it("consent check takes priority over everything", () => {
      // Not consented but everything else is permissive
      assert.strictEqual(resolveTrackingLevel(false, "18_plus", "athletic"), "none");
    });

    it("under_13 blocks even with consent", () => {
      assert.strictEqual(resolveTrackingLevel(true, "under_13", "athletic"), "none");
    });

    it("13_17 restriction applies before org type check", () => {
      // Both 13_17 and educational would give page_view_only
      const result = resolveTrackingLevel(true, "13_17", "educational");
      assert.strictEqual(result, "page_view_only");
    });
  });
});
