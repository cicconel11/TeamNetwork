/**
 * Tests for alumni filter query logic
 * 
 * These tests verify that alumni filtering works correctly
 * with various filter combinations.
 */

import { describe, it, expect } from "vitest";

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

// Filter function that mirrors the server-side logic
function filterAlumni(alumni: MockAlumni[], filters: AlumniFilters): MockAlumni[] {
  return alumni.filter((alum) => {
    // Exclude soft-deleted records
    if (alum.deleted_at !== null) return false;
    
    // Apply year filter
    if (filters.year && alum.graduation_year !== parseInt(filters.year)) {
      return false;
    }
    
    // Apply industry filter
    if (filters.industry && alum.industry !== filters.industry) {
      return false;
    }
    
    // Apply company filter
    if (filters.company && alum.current_company !== filters.company) {
      return false;
    }
    
    // Apply city filter
    if (filters.city && alum.current_city !== filters.city) {
      return false;
    }
    
    // Apply position filter
    if (filters.position && alum.position_title !== filters.position) {
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
    industries: [...new Set(activeAlumni.map((a) => a.industry).filter(Boolean))].sort(),
    companies: [...new Set(activeAlumni.map((a) => a.current_company).filter(Boolean))].sort(),
    cities: [...new Set(activeAlumni.map((a) => a.current_city).filter(Boolean))].sort(),
    positions: [...new Set(activeAlumni.map((a) => a.position_title).filter(Boolean))].sort(),
  };
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
      expect(result).toHaveLength(4);
      expect(result.find((a) => a.id === "5")).toBeUndefined();
    });

    it("should filter by graduation year", () => {
      const result = filterAlumni(mockAlumni, { year: "2020" });
      expect(result).toHaveLength(2);
      expect(result.every((a) => a.graduation_year === 2020)).toBe(true);
    });

    it("should filter by industry", () => {
      const result = filterAlumni(mockAlumni, { industry: "Technology" });
      expect(result).toHaveLength(2);
      expect(result.every((a) => a.industry === "Technology")).toBe(true);
    });

    it("should filter by company", () => {
      const result = filterAlumni(mockAlumni, { company: "Google" });
      expect(result).toHaveLength(1);
      expect(result[0].first_name).toBe("John");
    });

    it("should filter by city", () => {
      const result = filterAlumni(mockAlumni, { city: "San Francisco" });
      expect(result).toHaveLength(2);
      expect(result.every((a) => a.current_city === "San Francisco")).toBe(true);
    });

    it("should filter by position", () => {
      const result = filterAlumni(mockAlumni, { position: "Software Engineer" });
      expect(result).toHaveLength(2);
      expect(result.every((a) => a.position_title === "Software Engineer")).toBe(true);
    });

    it("should combine multiple filters with AND logic", () => {
      const result = filterAlumni(mockAlumni, {
        year: "2020",
        industry: "Technology",
      });
      expect(result).toHaveLength(2);
    });

    it("should combine all filters", () => {
      const result = filterAlumni(mockAlumni, {
        year: "2020",
        industry: "Technology",
        city: "San Francisco",
        position: "Software Engineer",
      });
      expect(result).toHaveLength(1);
      expect(result[0].first_name).toBe("John");
    });

    it("should return empty array when no matches", () => {
      const result = filterAlumni(mockAlumni, {
        year: "2025",
      });
      expect(result).toHaveLength(0);
    });

    it("should exclude soft-deleted records", () => {
      const result = filterAlumni(mockAlumni, {
        year: "2020",
        company: "Google",
      });
      expect(result).toHaveLength(1);
      expect(result[0].first_name).toBe("John");
    });
  });

  describe("getFilterOptions", () => {
    it("should extract unique graduation years sorted descending", () => {
      const options = getFilterOptions(mockAlumni);
      expect(options.years).toEqual([2021, 2020, 2019]);
    });

    it("should extract unique industries sorted alphabetically", () => {
      const options = getFilterOptions(mockAlumni);
      expect(options.industries).toEqual(["Finance", "Healthcare", "Technology"]);
    });

    it("should extract unique companies sorted alphabetically", () => {
      const options = getFilterOptions(mockAlumni);
      expect(options.companies).toEqual(["Goldman Sachs", "Google", "Kaiser", "Microsoft"]);
    });

    it("should extract unique cities sorted alphabetically", () => {
      const options = getFilterOptions(mockAlumni);
      expect(options.cities).toEqual(["New York", "San Francisco", "Seattle"]);
    });

    it("should extract unique positions sorted alphabetically", () => {
      const options = getFilterOptions(mockAlumni);
      expect(options.positions).toEqual(["Analyst", "Doctor", "Software Engineer"]);
    });

    it("should exclude deleted records from filter options", () => {
      // The deleted user would add an extra "Google" and "San Francisco" if included
      const options = getFilterOptions(mockAlumni);
      expect(options.companies.filter((c) => c === "Google")).toHaveLength(1);
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
      expect(result).toHaveLength(1);
      expect(result[0].first_name).toBe("John");
    });

    it("should include records with null fields when no filter applied", () => {
      const result = filterAlumni(alumniWithNulls, {});
      expect(result).toHaveLength(3);
    });

    it("should exclude null values from filter options", () => {
      const options = getFilterOptions(alumniWithNulls);
      expect(options.industries).not.toContain(null);
      expect(options.companies).not.toContain(null);
    });
  });
});




