/**
 * Typography Tests
 * Tests typography system constants and helper functions
 */

// Mock react-native before importing
jest.mock("react-native", () => ({
  Platform: {
    OS: "ios",
    select: jest.fn((options: Record<string, unknown>) => options.ios || options.default),
  },
}));

describe("Typography System", () => {
  let TYPOGRAPHY: typeof import("../../src/lib/typography").TYPOGRAPHY;
  let TEXT_STYLES: typeof import("../../src/lib/typography").TEXT_STYLES;
  let createTextStyle: typeof import("../../src/lib/typography").createTextStyle;

  beforeAll(() => {
    const mod = require("../../src/lib/typography");
    TYPOGRAPHY = mod.TYPOGRAPHY;
    TEXT_STYLES = mod.TEXT_STYLES;
    createTextStyle = mod.createTextStyle;
  });

  describe("TYPOGRAPHY scale", () => {
    it("should have display variants", () => {
      expect(TYPOGRAPHY.displayLarge).toBeDefined();
      expect(TYPOGRAPHY.displayMedium).toBeDefined();
    });

    it("should have headline variants", () => {
      expect(TYPOGRAPHY.headlineLarge).toBeDefined();
      expect(TYPOGRAPHY.headlineMedium).toBeDefined();
      expect(TYPOGRAPHY.headlineSmall).toBeDefined();
    });

    it("should have title variants", () => {
      expect(TYPOGRAPHY.titleLarge).toBeDefined();
      expect(TYPOGRAPHY.titleMedium).toBeDefined();
      expect(TYPOGRAPHY.titleSmall).toBeDefined();
    });

    it("should have body variants", () => {
      expect(TYPOGRAPHY.bodyLarge).toBeDefined();
      expect(TYPOGRAPHY.bodyMedium).toBeDefined();
      expect(TYPOGRAPHY.bodySmall).toBeDefined();
    });

    it("should have label variants", () => {
      expect(TYPOGRAPHY.labelLarge).toBeDefined();
      expect(TYPOGRAPHY.labelMedium).toBeDefined();
      expect(TYPOGRAPHY.labelSmall).toBeDefined();
    });

    it("should have caption and overline", () => {
      expect(TYPOGRAPHY.caption).toBeDefined();
      expect(TYPOGRAPHY.overline).toBeDefined();
    });

    it("should have proper text style properties", () => {
      const style = TYPOGRAPHY.bodyLarge;
      expect(style.fontSize).toBeDefined();
      expect(style.lineHeight).toBeDefined();
      expect(style.fontWeight).toBeDefined();
      expect(style.fontFamily).toBeDefined();
    });

    it("should have decreasing font sizes for hierarchy", () => {
      expect(TYPOGRAPHY.displayLarge.fontSize).toBeGreaterThan(
        TYPOGRAPHY.headlineLarge.fontSize
      );
      expect(TYPOGRAPHY.headlineLarge.fontSize).toBeGreaterThan(
        TYPOGRAPHY.titleLarge.fontSize
      );
      expect(TYPOGRAPHY.titleLarge.fontSize).toBeGreaterThan(
        TYPOGRAPHY.bodyLarge.fontSize
      );
    });
  });

  describe("TEXT_STYLES", () => {
    it("should have header styles", () => {
      expect(TEXT_STYLES.screenTitle).toBeDefined();
      expect(TEXT_STYLES.sectionTitle).toBeDefined();
      expect(TEXT_STYLES.cardTitle).toBeDefined();
    });

    it("should have body content styles", () => {
      expect(TEXT_STYLES.paragraph).toBeDefined();
      expect(TEXT_STYLES.description).toBeDefined();
      expect(TEXT_STYLES.detail).toBeDefined();
    });

    it("should have UI element styles", () => {
      expect(TEXT_STYLES.buttonLarge).toBeDefined();
      expect(TEXT_STYLES.buttonMedium).toBeDefined();
      expect(TEXT_STYLES.chip).toBeDefined();
      expect(TEXT_STYLES.badge).toBeDefined();
    });

    it("should have metadata styles", () => {
      expect(TEXT_STYLES.timestamp).toBeDefined();
      expect(TEXT_STYLES.helper).toBeDefined();
      expect(TEXT_STYLES.label).toBeDefined();
    });
  });

  describe("createTextStyle", () => {
    it("should return typography variant unchanged when no color", () => {
      const style = createTextStyle("bodyLarge");
      expect(style.fontSize).toBe(TYPOGRAPHY.bodyLarge.fontSize);
      expect(style.lineHeight).toBe(TYPOGRAPHY.bodyLarge.lineHeight);
    });

    it("should add color when provided", () => {
      const style = createTextStyle("bodyLarge", "#ff0000");
      expect(style.color).toBe("#ff0000");
    });

    it("should work with different variants", () => {
      const headline = createTextStyle("headlineLarge", "#000");
      expect(headline.fontSize).toBe(TYPOGRAPHY.headlineLarge.fontSize);
      expect(headline.color).toBe("#000");
    });
  });
});
