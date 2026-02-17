"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect, useCallback, useRef } from "react";
import { Card, Button, Select, Input, Badge } from "@/components/ui";
import { uniqueStringsCaseInsensitive } from "@/lib/string-utils";
import { trackBehavioralEvent } from "@/lib/analytics/events";

interface FilterOption {
  value: string;
  label: string;
}

interface JobsFiltersProps {
  orgId: string;
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

export function JobsFilters({
  orgId,
  locations,
  companies,
  industries,
}: JobsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const didMountRef = useRef(false);

  const [filters, setFilters] = useState({
    q: searchParams.get("q") || "",
    type: searchParams.get("type") || "",
    level: searchParams.get("level") || "",
    location: searchParams.get("location") || "",
    company: searchParams.get("company") || "",
    industry: searchParams.get("industry") || "",
  });

  const activeFilterCount = Object.values(filters).filter((v) => v !== "").length;
  const hasActiveFilters = activeFilterCount > 0;

  const updateURL = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.type) params.set("type", filters.type);
    if (filters.level) params.set("level", filters.level);
    if (filters.location) params.set("location", filters.location);
    if (filters.company) params.set("company", filters.company);
    if (filters.industry) params.set("industry", filters.industry);

    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname);
  }, [filters, pathname, router]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      updateURL();
      if (!didMountRef.current) {
        didMountRef.current = true;
        return;
      }
      const filterKeys = Object.entries(filters)
        .filter(([, value]) => value)
        .map(([key]) => key);
      trackBehavioralEvent("directory_filter_apply", {
        directory_type: "jobs",
        filter_keys: filterKeys,
        filters_count: filterKeys.length,
      }, orgId);
    }, 300);
    return () => clearTimeout(debounce);
  }, [filters, orgId, updateURL]);

  const clearFilters = () => {
    setFilters({
      q: "",
      type: "",
      level: "",
      location: "",
      company: "",
      industry: "",
    });
  };

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
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="Search jobs..."
              style={{ paddingLeft: "2.25rem" }}
            />
          </div>

          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setFilters({ ...filters, type: "" })}
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
                onClick={() =>
                  setFilters({ ...filters, type: filters.type === t ? "" : t })
                }
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
              onChange={(e) => setFilters({ ...filters, level: e.target.value })}
              options={EXPERIENCE_OPTIONS}
            />
          </div>
          <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
            <Select
              label="Location"
              value={filters.location}
              onChange={(e) => setFilters({ ...filters, location: e.target.value })}
              options={locationOptions}
            />
          </div>
          <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
            <Select
              label="Company"
              value={filters.company}
              onChange={(e) => setFilters({ ...filters, company: e.target.value })}
              options={companyOptions}
            />
          </div>
          <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
            <Select
              label="Industry"
              value={filters.industry}
              onChange={(e) => setFilters({ ...filters, industry: e.target.value })}
              options={industryOptions}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
