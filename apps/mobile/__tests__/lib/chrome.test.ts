/**
 * App Chrome Colors Tests
 * Tests app chrome color constants for header and tab bar
 */

import { APP_CHROME } from "../../src/lib/chrome";

describe("APP_CHROME", () => {
  describe("Header gradient colors", () => {
    it("should have gradient start and end colors", () => {
      expect(APP_CHROME.gradientStart).toBeDefined();
      expect(APP_CHROME.gradientEnd).toBeDefined();
    });

    it("should have valid hex colors for gradient", () => {
      expect(APP_CHROME.gradientStart).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(APP_CHROME.gradientEnd).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it("should use slate-900 for gradient start", () => {
      expect(APP_CHROME.gradientStart).toBe("#0f172a");
    });

    it("should use slate-950 for gradient end", () => {
      expect(APP_CHROME.gradientEnd).toBe("#020617");
    });
  });

  describe("Tab bar colors", () => {
    it("should have all tab bar color tokens", () => {
      expect(APP_CHROME.tabBarBackground).toBeDefined();
      expect(APP_CHROME.tabBarBorder).toBeDefined();
      expect(APP_CHROME.tabBarActive).toBeDefined();
      expect(APP_CHROME.tabBarInactive).toBeDefined();
    });

    it("should have white active color", () => {
      expect(APP_CHROME.tabBarActive).toBe("#ffffff");
    });

    it("should have slate-400 inactive color", () => {
      expect(APP_CHROME.tabBarInactive).toBe("#94a3b8");
    });
  });

  describe("Action button colors", () => {
    it("should have action button background and icon colors", () => {
      expect(APP_CHROME.actionButtonBackground).toBeDefined();
      expect(APP_CHROME.actionButtonIcon).toBeDefined();
    });

    it("should have white background for action button", () => {
      expect(APP_CHROME.actionButtonBackground).toBe("#ffffff");
    });

    it("should have dark icon color for contrast", () => {
      expect(APP_CHROME.actionButtonIcon).toBe("#0f172a");
    });
  });

  describe("Header text colors", () => {
    it("should have header title and meta colors", () => {
      expect(APP_CHROME.headerTitle).toBeDefined();
      expect(APP_CHROME.headerMeta).toBeDefined();
    });

    it("should have white header title", () => {
      expect(APP_CHROME.headerTitle).toBe("#ffffff");
    });

    it("should have semi-transparent header meta", () => {
      expect(APP_CHROME.headerMeta).toContain("rgba");
    });
  });

  describe("Avatar fallback colors", () => {
    it("should have avatar background and text colors", () => {
      expect(APP_CHROME.avatarBackground).toBeDefined();
      expect(APP_CHROME.avatarText).toBeDefined();
    });

    it("should have semi-transparent avatar background", () => {
      expect(APP_CHROME.avatarBackground).toContain("rgba");
    });

    it("should have white avatar text", () => {
      expect(APP_CHROME.avatarText).toBe("#ffffff");
    });
  });

  describe("Color consistency", () => {
    it("should have consistent dark theme (all headers/tabs use dark colors)", () => {
      // Gradient should go from dark to darker
      expect(APP_CHROME.gradientStart).not.toBe("#ffffff");
      expect(APP_CHROME.gradientEnd).not.toBe("#ffffff");

      // Tab bar background should be dark
      expect(APP_CHROME.tabBarBackground).toBe(APP_CHROME.gradientEnd);
    });
  });
});
