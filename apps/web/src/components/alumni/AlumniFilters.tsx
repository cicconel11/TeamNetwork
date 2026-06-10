"use client";

import { Button, Select } from "@/components/ui";
import { uniqueStringsCaseInsensitive } from "@/lib/string-utils";
import { trackBehavioralEvent } from "@/lib/analytics/events";
import { useUrlFilters } from "@/hooks/useUrlFilters";

interface FilterOption {
  value: string;
  label: string;
}

interface AlumniFiltersProps {
  orgId: string;
  years: (number | null)[];
  birthYears: (number | null)[];
  industries: (string | null)[];
  companies: (string | null)[];
  cities: (string | null)[];
  positions: (string | null)[];
}

const FILTER_KEYS = ["year", "birthYear", "industry", "company", "city", "position"] as const;

export function AlumniFilters({
  orgId,
  years,
  birthYears,
  industries,
  companies,
  cities,
  positions,
}: AlumniFiltersProps) {
  const { filters, setFilter, clearFilters, hasActiveFilters } = useUrlFilters({
    keys: FILTER_KEYS,
    onSync: (current) => {
      const filterKeys = Object.entries(current)
        .filter(([, value]) => value)
        .map(([key]) => key);
      trackBehavioralEvent("directory_filter_apply", {
        directory_type: "alumni",
        filter_keys: filterKeys,
        filters_count: filterKeys.length,
      }, orgId);
    },
  });

  const sortStrings = (values: (string | null)[]) =>
    uniqueStringsCaseInsensitive(values).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );

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

  const industryOptions: FilterOption[] = [
    { value: "", label: "All Industries" },
    ...sortStrings(industries).map((i) => ({ value: i, label: i })),
  ];

  const companyOptions: FilterOption[] = [
    { value: "", label: "All Companies" },
    ...sortStrings(companies).map((c) => ({ value: c, label: c })),
  ];

  const cityOptions: FilterOption[] = [
    { value: "", label: "All Cities" },
    ...sortStrings(cities).map((c) => ({ value: c, label: c })),
  ];

  const positionOptions: FilterOption[] = [
    { value: "", label: "All Positions" },
    ...sortStrings(positions).map((p) => ({ value: p, label: p })),
  ];

  return (
    <div className="space-y-4 mb-6">
      <div className="flex flex-wrap items-end gap-3">
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
            options={industryOptions}
          />
        </div>
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
          <Select
            label="Company"
            value={filters.company}
            onChange={(e) => setFilter("company", e.target.value)}
            options={companyOptions}
          />
        </div>
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
          <Select
            label="City"
            value={filters.city}
            onChange={(e) => setFilter("city", e.target.value)}
            options={cityOptions}
          />
        </div>
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
          <Select
            label="Position"
            value={filters.position}
            onChange={(e) => setFilter("position", e.target.value)}
            options={positionOptions}
          />
        </div>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-muted-foreground hover:text-foreground"
          >
            <svg
              className="h-4 w-4 mr-1"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
