"use client";

import { Card, Button, Select, Input, Badge } from "@/components/ui";
import { uniqueStringsCaseInsensitive } from "@/lib/string-utils";
import { useUrlFilters } from "@/hooks/useUrlFilters";

interface FilterOption {
  value: string;
  label: string;
}

interface JobsFiltersProps {
  locations: (string | null)[];
  companies: (string | null)[];
  industries: (string | null)[];
}

const LOCATION_TYPES = ["remote", "hybrid", "onsite"] as const;
const LOCATION_TYPE_LABELS: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "Onsite",
};

const EXPERIENCE_OPTIONS: FilterOption[] = [
  { value: "", label: "All Levels" },
  { value: "entry", label: "Entry Level" },
  { value: "mid", label: "Mid Level" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead" },
  { value: "executive", label: "Executive" },
];

const FILTER_KEYS = ["q", "type", "level", "location", "company", "industry"] as const;

export function JobsFilters({
  locations,
  companies,
  industries,
}: JobsFiltersProps) {
  const { filters, setFilter, clearFilters, hasActiveFilters, activeFilterCount } =
    useUrlFilters({ keys: FILTER_KEYS });

  const sortStrings = (values: (string | null)[]) =>
    uniqueStringsCaseInsensitive(values).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );

  const locationOptions: FilterOption[] = [
    { value: "", label: "All Locations" },
    ...sortStrings(locations).map((l) => ({ value: l, label: l })),
  ];

  const companyOptions: FilterOption[] = [
    { value: "", label: "All Companies" },
    ...sortStrings(companies).map((c) => ({ value: c, label: c })),
  ];

  const industryOptions: FilterOption[] = [
    { value: "", label: "All Industries" },
    ...sortStrings(industries).map((i) => ({ value: i, label: i })),
  ];

  return (
    <Card className="p-4">
      <div className="space-y-3">
        {/* Row 1: Search + Location Type Toggles + Clear */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="relative w-full sm:w-64">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <Input
              value={filters.q}
              onChange={(e) => setFilter("q", e.target.value)}
              placeholder="Search jobs..."
              style={{ paddingLeft: "2.25rem" }}
            />
          </div>

          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setFilter("type", "")}
              className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
                filters.type === ""
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              All
            </button>
            {LOCATION_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilter("type", filters.type === t ? "" : t)}
                className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
                  filters.type === t
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {LOCATION_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 sm:ml-auto">
            {hasActiveFilters && (
              <>
                <Badge variant="primary">{activeFilterCount}</Badge>
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
                  Clear
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Row 2: Select Dropdowns */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
            <Select
              label="Experience"
              value={filters.level}
              onChange={(e) => setFilter("level", e.target.value)}
              options={EXPERIENCE_OPTIONS}
            />
          </div>
          <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
            <Select
              label="Location"
              value={filters.location}
              onChange={(e) => setFilter("location", e.target.value)}
              options={locationOptions}
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
              label="Industry"
              value={filters.industry}
              onChange={(e) => setFilter("industry", e.target.value)}
              options={industryOptions}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
