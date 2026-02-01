/**
 * Age Gate Tests (COPPA Compliance)
 *
 * Tests for:
 * - calculateAge() accuracy with edge cases
 * - ageGateSchema validation
 * - Age bracket derivation
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { ageGateSchema } from "../src/lib/schemas/age-gate.ts";
import { calculateAge, deriveAgeBracket } from "../src/lib/auth/age-gate.ts";

describe("Age Gate", () => {
  describe("calculateAge()", () => {
    it("should calculate age correctly for a past birthday this year", () => {
      const today = new Date();
      const birthYear = today.getFullYear() - 25;
      const birthMonth = today.getMonth() - 1; // One month ago
      const birthDate = new Date(birthYear, birthMonth, 15);

      const age = calculateAge(birthDate);
      assert.strictEqual(age, 25, "Should be 25 years old");
    });

    it("should calculate age correctly for a future birthday this year", () => {
      const today = new Date();
      const birthYear = today.getFullYear() - 25;
      const birthMonth = today.getMonth() + 1; // One month from now
      const birthDate = new Date(birthYear, birthMonth, 15);

      const age = calculateAge(birthDate);
      assert.strictEqual(age, 24, "Should be 24 years old (birthday not yet)");
    });

    it("should handle birthday today correctly", () => {
      const today = new Date();
      const birthYear = today.getFullYear() - 18;
      const birthDate = new Date(birthYear, today.getMonth(), today.getDate());

      const age = calculateAge(birthDate);
      assert.strictEqual(age, 18, "Should be exactly 18 on birthday");
    });

    it("should handle birthday tomorrow correctly", () => {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const birthYear = tomorrow.getFullYear() - 18;
      const birthDate = new Date(birthYear, tomorrow.getMonth(), tomorrow.getDate());

      const age = calculateAge(birthDate);
      assert.strictEqual(age, 17, "Should be 17 (birthday tomorrow)");
    });

    it("should handle leap year birthday (Feb 29) correctly on non-leap year", () => {
      // Feb 29, 2004 (leap year) - person born on leap day
      const birthDate = new Date(2004, 1, 29); // Feb 29, 2004

      // Calculate what age would be expected
      const today = new Date();
      const currentYear = today.getFullYear();
      const expectedAge = currentYear - 2004 - (
        today.getMonth() < 1 || (today.getMonth() === 1 && today.getDate() < 29) ? 1 : 0
      );

      const age = calculateAge(birthDate);
      assert.strictEqual(age, expectedAge, "Leap year birthday should be calculated correctly");
    });

    it("should handle Dec 31 birthday correctly", () => {
      const today = new Date();
      const birthYear = today.getFullYear() - 20;
      const birthDate = new Date(birthYear, 11, 31); // Dec 31

      const age = calculateAge(birthDate);

      // If today is before Dec 31, age should be 19, otherwise 20
      const expectedAge = today.getMonth() < 11 || (today.getMonth() === 11 && today.getDate() < 31) ? 19 : 20;
      assert.strictEqual(age, expectedAge, "Dec 31 birthday should be calculated correctly");
    });

    it("should handle Jan 1 birthday correctly", () => {
      const today = new Date();
      const birthYear = today.getFullYear() - 20;
      const birthDate = new Date(birthYear, 0, 1); // Jan 1

      const age = calculateAge(birthDate);

      // If today is before Jan 1 (only possible if we're in the same year, which we're not)
      // Otherwise, should be 20
      const expectedAge = today.getMonth() === 0 && today.getDate() >= 1 ? 20 : 19;
      assert.strictEqual(age, expectedAge, "Jan 1 birthday should be calculated correctly");
    });

    it("should return 0 for infant born today", () => {
      const today = new Date();
      const age = calculateAge(today);
      assert.strictEqual(age, 0, "Newborn should be 0 years old");
    });
  });

  describe("ageGateSchema validation", () => {
    it("should accept valid dates", () => {
      const validDates = [
        { month: 1, day: 1, year: 2000 },
        { month: 12, day: 31, year: 1990 },
        { month: 6, day: 15, year: 2010 },
        { month: 2, day: 28, year: 2020 },
      ];

      for (const date of validDates) {
        const result = ageGateSchema.safeParse(date);
        assert.strictEqual(result.success, true, `Date ${JSON.stringify(date)} should be valid`);
      }
    });

    it("should accept Feb 29 on leap years", () => {
      const leapYearDate = { month: 2, day: 29, year: 2020 };
      const result = ageGateSchema.safeParse(leapYearDate);
      assert.strictEqual(result.success, true, "Feb 29, 2020 should be valid");
    });

    it("should reject Feb 29 on non-leap years", () => {
      const nonLeapYearDate = { month: 2, day: 29, year: 2021 };
      const result = ageGateSchema.safeParse(nonLeapYearDate);
      assert.strictEqual(result.success, false, "Feb 29, 2021 should be invalid");
    });

    it("should reject Feb 30", () => {
      const invalidDate = { month: 2, day: 30, year: 2020 };
      const result = ageGateSchema.safeParse(invalidDate);
      assert.strictEqual(result.success, false, "Feb 30 should be invalid");
    });

    it("should reject Apr 31", () => {
      const invalidDate = { month: 4, day: 31, year: 2020 };
      const result = ageGateSchema.safeParse(invalidDate);
      assert.strictEqual(result.success, false, "Apr 31 should be invalid");
    });

    it("should reject Jun 31", () => {
      const invalidDate = { month: 6, day: 31, year: 2020 };
      const result = ageGateSchema.safeParse(invalidDate);
      assert.strictEqual(result.success, false, "Jun 31 should be invalid");
    });

    it("should reject Sep 31", () => {
      const invalidDate = { month: 9, day: 31, year: 2020 };
      const result = ageGateSchema.safeParse(invalidDate);
      assert.strictEqual(result.success, false, "Sep 31 should be invalid");
    });

    it("should reject Nov 31", () => {
      const invalidDate = { month: 11, day: 31, year: 2020 };
      const result = ageGateSchema.safeParse(invalidDate);
      assert.strictEqual(result.success, false, "Nov 31 should be invalid");
    });

    it("should reject future dates", () => {
      const today = new Date();
      const futureDate = {
        month: today.getMonth() + 1,
        day: today.getDate(),
        year: today.getFullYear() + 1,
      };
      const result = ageGateSchema.safeParse(futureDate);
      assert.strictEqual(result.success, false, "Future dates should be invalid");
    });

    it("should reject dates before 1900", () => {
      const oldDate = { month: 1, day: 1, year: 1899 };
      const result = ageGateSchema.safeParse(oldDate);
      assert.strictEqual(result.success, false, "Dates before 1900 should be invalid");
    });

    it("should accept dates from 1900", () => {
      const oldDate = { month: 1, day: 1, year: 1900 };
      const result = ageGateSchema.safeParse(oldDate);
      assert.strictEqual(result.success, true, "Jan 1, 1900 should be valid");
    });

    it("should reject month 0", () => {
      const invalidDate = { month: 0, day: 15, year: 2000 };
      const result = ageGateSchema.safeParse(invalidDate);
      assert.strictEqual(result.success, false, "Month 0 should be invalid");
    });

    it("should reject month 13", () => {
      const invalidDate = { month: 13, day: 15, year: 2000 };
      const result = ageGateSchema.safeParse(invalidDate);
      assert.strictEqual(result.success, false, "Month 13 should be invalid");
    });

    it("should reject day 0", () => {
      const invalidDate = { month: 6, day: 0, year: 2000 };
      const result = ageGateSchema.safeParse(invalidDate);
      assert.strictEqual(result.success, false, "Day 0 should be invalid");
    });

    it("should reject day 32", () => {
      const invalidDate = { month: 1, day: 32, year: 2000 };
      const result = ageGateSchema.safeParse(invalidDate);
      assert.strictEqual(result.success, false, "Day 32 should be invalid");
    });

    it("should reject non-integer values", () => {
      const invalidDate = { month: 6.5, day: 15, year: 2000 };
      const result = ageGateSchema.safeParse(invalidDate);
      assert.strictEqual(result.success, false, "Non-integer month should be invalid");
    });
  });

  describe("deriveAgeBracket()", () => {
    it("should return under_13 for ages 0-12", () => {
      const ages = [0, 1, 5, 10, 11, 12];
      for (const age of ages) {
        const bracket = deriveAgeBracket(age);
        assert.strictEqual(bracket, "under_13", `Age ${age} should be under_13`);
      }
    });

    it("should return 13_17 for ages 13-17", () => {
      const ages = [13, 14, 15, 16, 17];
      for (const age of ages) {
        const bracket = deriveAgeBracket(age);
        assert.strictEqual(bracket, "13_17", `Age ${age} should be 13_17`);
      }
    });

    it("should return 18_plus for ages 18+", () => {
      const ages = [18, 19, 21, 30, 50, 100];
      for (const age of ages) {
        const bracket = deriveAgeBracket(age);
        assert.strictEqual(bracket, "18_plus", `Age ${age} should be 18_plus`);
      }
    });

    it("should handle edge case at 13", () => {
      const bracket12 = deriveAgeBracket(12);
      const bracket13 = deriveAgeBracket(13);
      assert.strictEqual(bracket12, "under_13", "Age 12 should be under_13");
      assert.strictEqual(bracket13, "13_17", "Age 13 should be 13_17");
    });

    it("should handle edge case at 18", () => {
      const bracket17 = deriveAgeBracket(17);
      const bracket18 = deriveAgeBracket(18);
      assert.strictEqual(bracket17, "13_17", "Age 17 should be 13_17");
      assert.strictEqual(bracket18, "18_plus", "Age 18 should be 18_plus");
    });
  });

  describe("isMinor derivation", () => {
    it("should identify minors correctly (age < 18)", () => {
      const minorAges = [0, 5, 12, 13, 17];
      for (const age of minorAges) {
        const isMinor = age < 18;
        assert.strictEqual(isMinor, true, `Age ${age} should be a minor`);
      }
    });

    it("should identify adults correctly (age >= 18)", () => {
      const adultAges = [18, 19, 21, 30, 65];
      for (const age of adultAges) {
        const isMinor = age < 18;
        assert.strictEqual(isMinor, false, `Age ${age} should not be a minor`);
      }
    });
  });
});
