"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect, useCallback, useRef } from "react";
import { Button, Select, Input } from "@/components/ui";
import { uniqueStringsCaseInsensitive } from "@/lib/string-utils";
import { trackBehavioralEvent } from "@/lib/analytics/events";

interface FilterOption {
  value: string;
  label: string;
}

interface ParentsFiltersProps {
  orgId: string;
  relationships: (string | null)[];
}

export function ParentsFilters({ orgId, relationships }: ParentsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const didMountRef = useRef(false);

  const [filters, setFilters] = useState({
    relationship: searchParams.get("relationship") || "",
    student_name: searchParams.get("student_name") || "",
  });

  const hasActiveFilters = Object.values(filters).some((v) => v !== "");

  const updateURL = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.relationship) params.set("relationship", filters.relationship);
    if (filters.student_name) params.set("student_name", filters.student_name);

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
        directory_type: "parents",
        filter_keys: filterKeys,
        filters_count: filterKeys.length,
      }, orgId);
    }, 300);
    return () => clearTimeout(debounce);
  }, [filters, orgId, updateURL]);

  const clearFilters = () => {
    setFilters({ relationship: "", student_name: "" });
  };

  const sortStrings = (values: (string | null)[]) =>
    uniqueStringsCaseInsensitive(values).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );

  const relationshipOptions: FilterOption[] = [
    { value: "", label: "All Relationships" },
    ...sortStrings(relationships).map((r) => ({ value: r, label: r })),
  ];

  return (
    <div className="space-y-4 mb-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
          <Select
            label="Relationship"
            value={filters.relationship}
            onChange={(e) => setFilters({ ...filters, relationship: e.target.value })}
            options={relationshipOptions}
          />
        </div>
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[200px]">
          <Input
            label="Student Name"
            placeholder="Search by student name..."
            value={filters.student_name}
            onChange={(e) => setFilters({ ...filters, student_name: e.target.value })}
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
