"use client";

import { Select } from "@/components/ui";

type MediaType = "all" | "image" | "video";

interface MediaFiltersProps {
  mediaType: MediaType;
  year: string;
  tag: string;
  availableYears: number[];
  availableTags: string[];
  onMediaTypeChange: (type: MediaType) => void;
  onYearChange: (year: string) => void;
  onTagChange: (tag: string) => void;
}

const TYPE_OPTIONS: { value: MediaType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "image", label: "Photos" },
  { value: "video", label: "Videos" },
];

export function MediaFilters({
  mediaType,
  year,
  tag,
  availableYears,
  availableTags,
  onMediaTypeChange,
  onYearChange,
  onTagChange,
}: MediaFiltersProps) {
  const yearOptions = [
    { value: "", label: "All Years" },
    ...availableYears.map((y) => ({ value: String(y), label: String(y) })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 mb-6">
      {/* Type toggle pills */}
      <div className="flex items-center rounded-full bg-muted p-1 gap-0.5">
        {TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onMediaTypeChange(opt.value)}
            className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
              mediaType === opt.value
                ? "bg-org-secondary text-org-secondary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Year dropdown */}
      {availableYears.length > 0 && (
        <div className="w-32">
          <Select
            options={yearOptions}
            value={year}
            onChange={(e) => onYearChange(e.target.value)}
          />
        </div>
      )}

      {/* Tag chips */}
      {availableTags.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {tag && (
            <button
              onClick={() => onTagChange("")}
              className="shrink-0 px-3 py-1 text-xs font-medium rounded-full bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
          {availableTags.map((t) => (
            <button
              key={t}
              onClick={() => onTagChange(tag === t ? "" : t)}
              className={`shrink-0 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                tag === t
                  ? "bg-org-secondary text-org-secondary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
