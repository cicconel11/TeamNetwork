"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { Button, Select } from "@/components/ui";

interface FilterOption {
  value: string;
  label: string;
}

interface EnterpriseAlumniFiltersProps {
  organizations: { id: string; name: string }[];
  years: (number | null)[];
  industries: string[];
  companies: string[];
  cities: string[];
  positions: string[];
}

export function EnterpriseAlumniFilters({
  organizations,
  years,
  industries,
  companies,
  cities,
  positions,
}: EnterpriseAlumniFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState({
    org: searchParams.get("org") || "",
    year: searchParams.get("year") || "",
    industry: searchParams.get("industry") || "",
    company: searchParams.get("company") || "",
    city: searchParams.get("city") || "",
    position: searchParams.get("position") || "",
    hasEmail: searchParams.get("hasEmail") || "",
    hasPhone: searchParams.get("hasPhone") || "",
  });

  const hasActiveFilters = Object.values(filters).some((v) => v !== "");

  const updateURL = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.org) params.set("org", filters.org);
    if (filters.year) params.set("year", filters.year);
    if (filters.industry) params.set("industry", filters.industry);
    if (filters.company) params.set("company", filters.company);
    if (filters.city) params.set("city", filters.city);
    if (filters.position) params.set("position", filters.position);
    if (filters.hasEmail) params.set("hasEmail", filters.hasEmail);
    if (filters.hasPhone) params.set("hasPhone", filters.hasPhone);

    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname);
  }, [filters, pathname, router]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      updateURL();
    }, 300);
    return () => clearTimeout(debounce);
  }, [filters, updateURL]);

  const clearFilters = () => {
    setFilters({
      org: "",
      year: "",
      industry: "",
      company: "",
      city: "",
      position: "",
      hasEmail: "",
      hasPhone: "",
    });
  };

  const orgOptions: FilterOption[] = [
    { value: "", label: "All Organizations" },
    ...organizations.map((o) => ({ value: o.id, label: o.name })),
  ];

  const yearOptions: FilterOption[] = [
    { value: "", label: "All Years" },
    ...years
      .filter((y): y is number => y !== null)
      .sort((a, b) => b - a)
      .map((y) => ({ value: y.toString(), label: `Class of ${y}` })),
  ];

  const makeOptions = (values: string[], allLabel: string): FilterOption[] => [
    { value: "", label: allLabel },
    ...values.map((v) => ({ value: v, label: v })),
  ];

  const boolOptions: FilterOption[] = [
    { value: "", label: "Any" },
    { value: "true", label: "Yes" },
    { value: "false", label: "No" },
  ];

  return (
    <div className="space-y-4 mb-6">
      {/* First Row: Organization + Main Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[180px]">
          <Select
            label="Organization"
            value={filters.org}
            onChange={(e) => setFilters({ ...filters, org: e.target.value })}
            options={orgOptions}
          />
        </div>
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
          <Select
            label="Graduation Year"
            value={filters.year}
            onChange={(e) => setFilters({ ...filters, year: e.target.value })}
            options={yearOptions}
          />
        </div>
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
          <Select
            label="Industry"
            value={filters.industry}
            onChange={(e) => setFilters({ ...filters, industry: e.target.value })}
            options={makeOptions(industries, "All Industries")}
          />
        </div>
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
          <Select
            label="Company"
            value={filters.company}
            onChange={(e) => setFilters({ ...filters, company: e.target.value })}
            options={makeOptions(companies, "All Companies")}
          />
        </div>
      </div>

      {/* Second Row: Additional Filters + Contact Toggles */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
          <Select
            label="City"
            value={filters.city}
            onChange={(e) => setFilters({ ...filters, city: e.target.value })}
            options={makeOptions(cities, "All Cities")}
          />
        </div>
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
          <Select
            label="Position"
            value={filters.position}
            onChange={(e) => setFilters({ ...filters, position: e.target.value })}
            options={makeOptions(positions, "All Positions")}
          />
        </div>
        <div className="w-full sm:w-auto sm:min-w-[100px]">
          <Select
            label="Has Email"
            value={filters.hasEmail}
            onChange={(e) => setFilters({ ...filters, hasEmail: e.target.value })}
            options={boolOptions}
          />
        </div>
        <div className="w-full sm:w-auto sm:min-w-[100px]">
          <Select
            label="Has Phone"
            value={filters.hasPhone}
            onChange={(e) => setFilters({ ...filters, hasPhone: e.target.value })}
            options={boolOptions}
          />
        </div>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-muted-foreground hover:text-foreground"
          >
            <XIcon className="h-4 w-4 mr-1" />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
