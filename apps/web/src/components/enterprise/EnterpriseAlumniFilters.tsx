"use client";

import { Button, Select } from "@/components/ui";
import { useUrlFilters } from "@/hooks/useUrlFilters";

interface FilterOption {
  value: string;
  label: string;
}

interface EnterpriseAlumniFiltersProps {
  organizations: { id: string; name: string }[];
  years: (number | null)[];
  birthYears: (number | null)[];
  industries: string[];
  companies: string[];
  cities: string[];
  positions: string[];
}

const FILTER_KEYS = [
  "org",
  "year",
  "birthYear",
  "industry",
  "company",
  "city",
  "position",
  "hasEmail",
  "hasPhone",
] as const;

export function EnterpriseAlumniFilters({
  organizations,
  years,
  birthYears,
  industries,
  companies,
  cities,
  positions,
}: EnterpriseAlumniFiltersProps) {
  const { filters, setFilter, clearFilters, hasActiveFilters } = useUrlFilters({
    keys: FILTER_KEYS,
  });

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

  const birthYearOptions: FilterOption[] = [
    { value: "", label: "All Years" },
    ...birthYears
      .filter((y): y is number => y !== null)
      .sort((a, b) => b - a)
      .map((y) => ({ value: y.toString(), label: y.toString() })),
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
            onChange={(e) => setFilter("org", e.target.value)}
            options={orgOptions}
          />
        </div>
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
          <Select
            label="Graduation Year"
            value={filters.year}
            onChange={(e) => setFilter("year", e.target.value)}
            options={yearOptions}
          />
        </div>
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
          <Select
            label="Year of Birth"
            value={filters.birthYear}
            onChange={(e) => setFilter("birthYear", e.target.value)}
            options={birthYearOptions}
          />
        </div>
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
          <Select
            label="Industry"
            value={filters.industry}
            onChange={(e) => setFilter("industry", e.target.value)}
            options={makeOptions(industries, "All Industries")}
          />
        </div>
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
          <Select
            label="Company"
            value={filters.company}
            onChange={(e) => setFilter("company", e.target.value)}
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
            onChange={(e) => setFilter("city", e.target.value)}
            options={makeOptions(cities, "All Cities")}
          />
        </div>
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
          <Select
            label="Position"
            value={filters.position}
            onChange={(e) => setFilter("position", e.target.value)}
            options={makeOptions(positions, "All Positions")}
          />
        </div>
        <div className="w-full sm:w-auto sm:min-w-[100px]">
          <Select
            label="Has Email"
            value={filters.hasEmail}
            onChange={(e) => setFilter("hasEmail", e.target.value)}
            options={boolOptions}
          />
        </div>
        <div className="w-full sm:w-auto sm:min-w-[100px]">
          <Select
            label="Has Phone"
            value={filters.hasPhone}
            onChange={(e) => setFilter("hasPhone", e.target.value)}
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
