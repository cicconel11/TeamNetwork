/**
 * Theme Library Tests
 * Tests color math functions and theme building
 * Note: This tests the pure functions only, not RN components
 */

// Import only the pure functions, not the primitives that depend on React Native StyleSheet
import {
  buildOrgTheme,
  defaultThemeColors,
  colors,
  spacing,
  borderRadius,
  fontSize,
  fontWeight,
  ThemeColors,
} from "../../src/lib/theme";

describe("Theme Library", () => {
  describe("buildOrgTheme", () => {
    it("should return default theme with no arguments", () => {
      const theme = buildOrgTheme();
      expect(theme).toHaveProperty("primary");
      expect(theme).toHaveProperty("secondary");
      expect(theme).toHaveProperty("background");
      expect(theme).toHaveProperty("foreground");
    });

    it("should return default theme with null primary color", () => {
      const theme = buildOrgTheme(null);
      expect(theme.primary).toBe("#1e3a5f");
    });

    it("should return default theme with undefined primary color", () => {
      const theme = buildOrgTheme(undefined);
      expect(theme.primary).toBe("#1e3a5f");
    });

    it("should return default theme with invalid hex color", () => {
      const theme = buildOrgTheme("invalid");
      expect(theme.primary).toBe("#1e3a5f");
    });

    it("should return default theme with 3-digit hex color", () => {
      // 3-digit hex is not supported as valid input
      const theme = buildOrgTheme("#abc");
      expect(theme.primary).toBe("#1e3a5f");
    });

    it("should return default theme with hex missing hash", () => {
      const theme = buildOrgTheme("1e3a5f");
      expect(theme.primary).toBe("#1e3a5f");
    });

    it("should use valid primary color when provided", () => {
      const theme = buildOrgTheme("#ff0000");
      expect(theme.primary).toBe("#ff0000");
    });

    it("should use valid secondary color when provided", () => {
      const theme = buildOrgTheme("#1e3a5f", "#00ff00");
      expect(theme.secondary).toBe("#00ff00");
    });

    it("should fallback secondary to default when invalid", () => {
      const theme = buildOrgTheme("#1e3a5f", "invalid");
      expect(theme.secondary).toBe("#10b981");
    });

    it("should generate all 18 theme colors", () => {
      const theme = buildOrgTheme("#1e3a5f", "#10b981");
      const expectedKeys: (keyof ThemeColors)[] = [
        "primary",
        "primaryLight",
        "primaryDark",
        "primaryForeground",
        "secondary",
        "secondaryLight",
        "secondaryDark",
        "secondaryForeground",
        "background",
        "card",
        "foreground",
        "muted",
        "mutedSurface",
        "mutedForeground",
        "border",
        "success",
        "warning",
        "error",
      ];
      expectedKeys.forEach((key) => {
        expect(theme).toHaveProperty(key);
        expect(typeof theme[key]).toBe("string");
        expect(theme[key]).toMatch(/^#[0-9a-fA-F]{6}$/);
      });
    });

    it("should generate lighter variant for primaryLight", () => {
      const theme = buildOrgTheme("#000000");
      // Dark color should get lighter
      expect(theme.primaryLight).not.toBe("#000000");
    });

    it("should generate darker variant for primaryDark", () => {
      const theme = buildOrgTheme("#ffffff");
      // Light color should get darker
      expect(theme.primaryDark).not.toBe("#ffffff");
    });

    it("should use light foreground for dark primary", () => {
      const theme = buildOrgTheme("#000000");
      expect(theme.primaryForeground).toBe("#f8fafc");
    });

    it("should use dark foreground for light primary", () => {
      const theme = buildOrgTheme("#ffffff");
      expect(theme.primaryForeground).toBe("#0f172a");
    });

    it("should always have fixed semantic colors", () => {
      const theme1 = buildOrgTheme("#000000");
      const theme2 = buildOrgTheme("#ffffff");

      expect(theme1.success).toBe("#10b981");
      expect(theme1.warning).toBe("#f59e0b");
      expect(theme1.error).toBe("#dc2626");

      expect(theme2.success).toBe("#10b981");
      expect(theme2.warning).toBe("#f59e0b");
      expect(theme2.error).toBe("#dc2626");
    });

    it("should clamp color adjustments to valid range", () => {
      // When adjusting pure white up, should clamp at 255
      const theme = buildOrgTheme("#ffffff");
      const hexPattern = /^#[0-9a-fA-F]{6}$/;
      expect(theme.primaryLight).toMatch(hexPattern);

      // When adjusting pure black down, should clamp at 0
      const darkTheme = buildOrgTheme("#000000");
      expect(darkTheme.primaryDark).toMatch(hexPattern);
    });
  });

  describe("defaultThemeColors", () => {
    it("should be a valid theme object", () => {
      expect(defaultThemeColors).toHaveProperty("primary");
      expect(defaultThemeColors).toHaveProperty("secondary");
      expect(defaultThemeColors.primary).toBe("#1e3a5f");
    });

    it("should equal buildOrgTheme with defaults", () => {
      const freshTheme = buildOrgTheme();
      expect(defaultThemeColors).toEqual(freshTheme);
    });
  });

  describe("colors export", () => {
    it("should equal defaultThemeColors", () => {
      expect(colors).toEqual(defaultThemeColors);
    });
  });

  describe("spacing", () => {
    it("should have all expected spacing values", () => {
      expect(spacing.xs).toBe(4);
      expect(spacing.sm).toBe(8);
      expect(spacing.md).toBe(16);
      expect(spacing.lg).toBe(24);
      expect(spacing.xl).toBe(32);
    });
  });

  describe("borderRadius", () => {
    it("should have all expected radius values", () => {
      expect(borderRadius.sm).toBe(6);
      expect(borderRadius.md).toBe(8);
      expect(borderRadius.lg).toBe(12);
      expect(borderRadius.xl).toBe(16);
    });
  });

  describe("fontSize", () => {
    it("should have all expected font size values", () => {
      expect(fontSize.xs).toBe(12);
      expect(fontSize.sm).toBe(14);
      expect(fontSize.base).toBe(16);
      expect(fontSize.lg).toBe(18);
      expect(fontSize.xl).toBe(20);
      expect(fontSize["2xl"]).toBe(24);
    });
  });

  describe("fontWeight", () => {
    it("should have all expected font weight values", () => {
      expect(fontWeight.normal).toBe("400");
      expect(fontWeight.medium).toBe("500");
      expect(fontWeight.semibold).toBe("600");
      expect(fontWeight.bold).toBe("700");
    });
  });
});

describe("Color Math Edge Cases", () => {
  it("should handle uppercase hex colors", () => {
    const theme = buildOrgTheme("#FF0000");
    expect(theme.primary).toBe("#FF0000");
  });

  it("should handle mixed case hex colors", () => {
    const theme = buildOrgTheme("#fF00aB");
    expect(theme.primary).toBe("#fF00aB");
  });

  it("should produce consistent results for same input", () => {
    const theme1 = buildOrgTheme("#123456", "#789abc");
    const theme2 = buildOrgTheme("#123456", "#789abc");
    expect(theme1).toEqual(theme2);
  });

  it("should handle grayscale colors", () => {
    const grayTheme = buildOrgTheme("#808080");
    expect(grayTheme.primary).toBe("#808080");
    expect(grayTheme.primaryLight).not.toBe("#808080");
    expect(grayTheme.primaryDark).not.toBe("#808080");
  });
});
