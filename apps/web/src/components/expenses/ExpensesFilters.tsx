"use client";

import { Button, Select } from "@/components/ui";
import { useUrlFilters } from "@/hooks/useUrlFilters";

interface FilterOption {
  value: string;
  label: string;
}

interface Submitter {
  id: string;
  name: string | null;
  email: string;
}

interface ExpensesFiltersProps {
  expenseTypes: string[];
  submitters: Submitter[];
}

const FILTER_KEYS = ["type", "user"] as const;

export function ExpensesFilters({ expenseTypes, submitters }: ExpensesFiltersProps) {
  const { filters, setFilter, clearFilters, hasActiveFilters } = useUrlFilters({
    keys: FILTER_KEYS,
  });

  const typeOptions: FilterOption[] = [
    { value: "", label: "All Types" },
    ...expenseTypes.map((t) => ({ value: t, label: t })),
  ];

  const userOptions: FilterOption[] = [
    { value: "", label: "All Users" },
    ...submitters.map((u) => ({ value: u.id, label: u.name || u.email })),
  ];

  return (
    <div className="space-y-4 mb-6">
      <div className="flex flex-wrap items-end gap-3">
        {expenseTypes.length > 0 && (
          <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
            <Select
              label="Expense Type"
              value={filters.type}
              onChange={(e) => setFilter("type", e.target.value)}
              options={typeOptions}
            />
          </div>
        )}
        {submitters.length > 0 && (
          <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
            <Select
              label="Submitted By"
              value={filters.user}
              onChange={(e) => setFilter("user", e.target.value)}
              options={userOptions}
            />
          </div>
        )}
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
