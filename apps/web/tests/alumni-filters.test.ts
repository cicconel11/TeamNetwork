/**
 * Tests for alumni filter query logic
 * 
 * These tests verify that alumni filtering works correctly
 * with various filter combinations.
 */

import { describe, it } from "node:test";
import assert from "node:assert";

// Mock alumni data structure matching the expanded schema
interface MockAlumni {
  id: string;
  organization_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  graduation_year: number | null;
  industry: string | null;
  current_company: string | null;
  current_city: string | null;
  position_title: string | null;
  deleted_at: string | null;
}

// Filter parameters structure
interface AlumniFilters {
  year?: string;
  industry?: string;
  company?: string;
  city?: string;
  position?: string;
}

const normalize = (value?: string | null) =>
  typeof value === "string" ? value.trim().toLowerCase() : null;

const matchesIgnoreCase = (field: string | null, filter: string | null) => {
  if (!filter) return true;
  return normalize(field) === filter;
};

const uniqueCaseInsensitive = (values: Array<string | null>) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalize(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push((value as string).trim());
  }

  return result;
};

// Filter function that mirrors the server-side logic
function filterAlumni(alumni: MockAlumni[], filters: AlumniFilters): MockAlumni[] {
  const industryFilter = normalize(filters.industry);
  const companyFilter = normalize(filters.company);
  const cityFilter = normalize(filters.city);
  const positionFilter = normalize(filters.position);

  return alumni.filter((alum) => {
    // Exclude soft-deleted records
    if (alum.deleted_at !== null) return false;

    // Apply year filter
    if (filters.year && alum.graduation_year !== parseInt(filters.year)) {
      return false;
    }

    // Apply industry filter
    if (!matchesIgnoreCase(alum.industry, industryFilter)) {
      return false;
    }

    // Apply company filter
    if (!matchesIgnoreCase(alum.current_company, companyFilter)) {
      return false;
    }

    // Apply city filter
    if (!matchesIgnoreCase(alum.current_city, cityFilter)) {
      return false;
    }

    // Apply position filter
    if (!matchesIgnoreCase(alum.position_title, positionFilter)) {
      return false;
    }

    return true;
  });
}

// Extract unique filter options
function getFilterOptions(alumni: MockAlumni[]) {
  const activeAlumni = alumni.filter((a) => a.deleted_at === null);

  return {
    years: [...new Set(activeAlumni.map((a) => a.graduation_year).filter(Boolean))].sort((a, b) => (b || 0) - (a || 0)),
    industries: uniqueCaseInsensitive(activeAlumni.map((a) => a.industry)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    companies: uniqueCaseInsensitive(activeAlumni.map((a) => a.current_company)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    cities: uniqueCaseInsensitive(activeAlumni.map((a) => a.current_city)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    positions: uniqueCaseInsensitive(activeAlumni.map((a) => a.position_title)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
  };
}

// Helper to check if array contains all expected items
function arrayContainsAll<T>(arr: T[], expected: T[]): boolean {
  return expected.every(item => arr.includes(item));
}

describe("Alumni Filters", () => {
  const mockAlumni: MockAlumni[] = [
    {
      id: "1",
      organization_id: "org-1",
      first_name: "John",
      last_name: "Doe",
      email: "john@example.com",
      graduation_year: 2020,
      industry: "Technology",
      current_company: "Google",
      current_city: "San Francisco",
      position_title: "Software Engineer",
      deleted_at: null,
    },
    {
      id: "2",
      organization_id: "org-1",
      first_name: "Jane",
      last_name: "Smith",
      email: "jane@example.com",
      graduation_year: 2021,
      industry: "Finance",
      current_company: "Goldman Sachs",
      current_city: "New York",
      position_title: "Analyst",
      deleted_at: null,
    },
    {
      id: "3",
      organization_id: "org-1",
      first_name: "Bob",
      last_name: "Johnson",
      email: "bob@example.com",
      graduation_year: 2020,
      industry: "Technology",
      current_company: "Microsoft",
      current_city: "Seattle",
      position_title: "Software Engineer",
      deleted_at: null,
    },
    {
      id: "4",
      organization_id: "org-1",
      first_name: "Alice",
      last_name: "Williams",
      email: "alice@example.com",
      graduation_year: 2019,
      industry: "Healthcare",
      current_company: "Kaiser",
      current_city: "San Francisco",
      position_title: "Doctor",
      deleted_at: null,
    },
    {
      id: "6",
      organization_id: "org-1",
      first_name: "Case",
      last_name: "Match",
      email: "case@example.com",
      graduation_year: 2020,
      industry: "technology",
      current_company: "google",
      current_city: "san francisco",
      position_title: "software engineer",
      deleted_at: null,
    },
    {
      id: "5",
      organization_id: "org-1",
      first_name: "Deleted",
      last_name: "User",
      email: "deleted@example.com",
      graduation_year: 2020,
      industry: "Technology",
      current_company: "Google",
      current_city: "San Francisco",
      position_title: "Software Engineer",
      deleted_at: "2024-01-01T00:00:00Z",
    },
  ];

  describe("filterAlumni", () => {
    it("should return all non-deleted alumni with no filters", () => {
      const result = filterAlumni(mockAlumni, {});
      assert.strictEqual(result.length, 5);
      assert.strictEqual(result.find((a) => a.id === "5"), undefined);
    });

    it("should filter by graduation year", () => {
      const result = filterAlumni(mockAlumni, { year: "2020" });
      // John, Bob, and Case all have graduation_year 2020
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result.every((a) => a.graduation_year === 2020), true);
    });

    it("should filter by industry", () => {
      const result = filterAlumni(mockAlumni, { industry: "Technology" });
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result.every((a) => a.industry?.toLowerCase() === "technology"), true);
    });

    it("should filter by company", () => {
      const result = filterAlumni(mockAlumni, { company: "Google" });
      assert.strictEqual(result.length, 2);
      assert.ok(arrayContainsAll(result.map((a) => a.first_name), ["John", "Case"]));
    });

    it("should filter by city", () => {
      const result = filterAlumni(mockAlumni, { city: "San Francisco" });
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result.every((a) => a.current_city?.toLowerCase() === "san francisco"), true);
    });

    it("should filter by position", () => {
      const result = filterAlumni(mockAlumni, { position: "Software Engineer" });
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result.every((a) => a.position_title?.toLowerCase() === "software engineer"), true);
    });

    it("should combine multiple filters with AND logic", () => {
      const result = filterAlumni(mockAlumni, {
        year: "2020",
        industry: "Technology",
      });
      assert.strictEqual(result.length, 3);
    });

    it("should combine all filters", () => {
      const result = filterAlumni(mockAlumni, {
        year: "2020",
        industry: "Technology",
        city: "San Francisco",
        position: "Software Engineer",
      });
      assert.strictEqual(result.length, 2);
      assert.ok(arrayContainsAll(result.map((a) => a.first_name), ["John", "Case"]));
    });

    it("should return empty array when no matches", () => {
      const result = filterAlumni(mockAlumni, {
        year: "2025",
      });
      assert.strictEqual(result.length, 0);
    });

    it("should exclude soft-deleted records", () => {
      const result = filterAlumni(mockAlumni, {
        year: "2020",
        company: "Google",
      });
      assert.strictEqual(result.length, 2);
      assert.ok(arrayContainsAll(result.map((a) => a.first_name), ["John", "Case"]));
    });

    it("should match filters regardless of casing", () => {
      const result = filterAlumni(mockAlumni, {
        company: "GOOGLE",
        city: "SAN FRANCISCO",
      });
      assert.strictEqual(result.length, 2);
      assert.ok(arrayContainsAll(result.map((a) => a.first_name), ["John", "Case"]));
    });
  });

  describe("getFilterOptions", () => {
    it("should extract unique graduation years sorted descending", () => {
      const options = getFilterOptions(mockAlumni);
      assert.deepStrictEqual(options.years, [2021, 2020, 2019]);
    });

    it("should extract unique industries sorted alphabetically", () => {
      const options = getFilterOptions(mockAlumni);
      assert.deepStrictEqual(options.industries, ["Finance", "Healthcare", "Technology"]);
    });

    it("should extract unique companies sorted alphabetically", () => {
      const options = getFilterOptions(mockAlumni);
      assert.deepStrictEqual(options.companies, ["Goldman Sachs", "Google", "Kaiser", "Microsoft"]);
    });

    it("should extract unique cities sorted alphabetically", () => {
      const options = getFilterOptions(mockAlumni);
      assert.deepStrictEqual(options.cities, ["New York", "San Francisco", "Seattle"]);
    });

    it("should extract unique positions sorted alphabetically", () => {
      const options = getFilterOptions(mockAlumni);
      assert.deepStrictEqual(options.positions, ["Analyst", "Doctor", "Software Engineer"]);
    });

    it("should exclude deleted records from filter options", () => {
      // The deleted user would add an extra "Google" and "San Francisco" if included
      const options = getFilterOptions(mockAlumni);
      assert.strictEqual(options.companies.filter((c) => c === "Google").length, 1);
    });

    it("should group duplicate values with different casing into a single option", () => {
      const options = getFilterOptions(mockAlumni);
      assert.deepStrictEqual(options.industries, ["Finance", "Healthcare", "Technology"]);
      assert.ok(options.companies.includes("Google"));
      assert.strictEqual(options.companies.filter((c) => c === "Google").length, 1);
    });
  });

  describe("Filter with null values", () => {
    const alumniWithNulls: MockAlumni[] = [
      ...mockAlumni.slice(0, 2),
      {
        id: "6",
        organization_id: "org-1",
        first_name: "No",
        last_name: "Industry",
        email: "no@example.com",
        graduation_year: 2020,
        industry: null,
        current_company: null,
        current_city: null,
        position_title: null,
        deleted_at: null,
      },
    ];

    it("should not match null values to filters", () => {
      const result = filterAlumni(alumniWithNulls, { industry: "Technology" });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].first_name, "John");
    });

    it("should include records with null fields when no filter applied", () => {
      const result = filterAlumni(alumniWithNulls, {});
      assert.strictEqual(result.length, 3);
    });

    it("should exclude null values from filter options", () => {
      const options = getFilterOptions(alumniWithNulls);
      assert.ok(!options.industries.includes(null as unknown as string));
      assert.ok(!options.companies.includes(null as unknown as string));
    });
  });
});
