"use client";

import { useState } from "react";
import { Button, InlineBanner } from "@/components/ui";

interface ExportField {
  key: string;
  label: string;
  default: boolean;
}

const EXPORT_FIELDS: ExportField[] = [
  { key: "first_name", label: "First Name", default: true },
  { key: "last_name", label: "Last Name", default: true },
  { key: "email", label: "Email", default: true },
  { key: "phone_number", label: "Phone", default: true },
  { key: "organization_name", label: "Organization", default: true },
  { key: "graduation_year", label: "Graduation Year", default: true },
  { key: "birth_year", label: "Year of Birth", default: false },
  { key: "major", label: "Major", default: false },
  { key: "industry", label: "Industry", default: true },
  { key: "current_company", label: "Company", default: true },
  { key: "position_title", label: "Position", default: true },
  { key: "current_city", label: "City", default: true },
  { key: "linkedin_url", label: "LinkedIn URL", default: false },
  { key: "notes", label: "Notes", default: false },
];

const EXPORT_ROW_LIMIT = 10000;

interface BulkExportButtonProps {
  enterpriseId: string;
  selectedIds?: Set<string>;
  filters?: Record<string, string>;
  totalCount: number;
}

export function BulkExportButton({
  enterpriseId,
  selectedIds,
  filters = {},
  totalCount,
}: BulkExportButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(
    new Set(EXPORT_FIELDS.filter((f) => f.default).map((f) => f.key))
  );
  const [isExporting, setIsExporting] = useState(false);
  const [truncationMessage, setTruncationMessage] = useState<string | null>(null);

  const toggleField = (key: string) => {
    const newFields = new Set(selectedFields);
    if (newFields.has(key)) {
      newFields.delete(key);
    } else {
      newFields.add(key);
    }
    setSelectedFields(newFields);
  };

  const handleExport = async () => {
    setIsExporting(true);
    setTruncationMessage(null);
    try {
      const params = new URLSearchParams();
      params.set("format", "csv");
      params.set("fields", Array.from(selectedFields).join(","));

      // Add filters
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });

      // Add selected IDs if any
      if (selectedIds && selectedIds.size > 0) {
        params.set("ids", Array.from(selectedIds).join(","));
      }

      const response = await fetch(
        `/api/enterprise/${enterpriseId}/alumni/export?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error("Export failed");
      }

      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = "alumni-export.csv";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?(.+)"?/);
        if (match) filename = match[1];
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      if (response.headers.get("X-Export-Truncated") === "true") {
        const rowLimitHeader = response.headers.get("X-Export-Row-Limit");
        const rowLimit = Number.parseInt(rowLimitHeader ?? "", 10);
        const appliedLimit = Number.isFinite(rowLimit) ? rowLimit : EXPORT_ROW_LIMIT;
        setTruncationMessage(
          `This export was limited to the first ${appliedLimit.toLocaleString()} alumni. Narrow filters or export a smaller selection to download the rest.`
        );
      }

      setIsModalOpen(false);
    } catch (error) {
      console.error("Export failed:", error);
      alert("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const exportCount = selectedIds && selectedIds.size > 0 ? selectedIds.size : totalCount;
  const willTruncate = exportCount > EXPORT_ROW_LIMIT;

  return (
    <>
      <div className="flex flex-col items-end gap-2">
        <Button variant="secondary" onClick={() => setIsModalOpen(true)}>
          <DownloadIcon className="h-4 w-4" />
          Export
          {selectedIds && selectedIds.size > 0 && (
            <span className="ml-1 text-xs opacity-75">({selectedIds.size})</span>
          )}
        </Button>
        {truncationMessage && (
          <InlineBanner variant="warning" className="max-w-sm text-left">
            {truncationMessage}
          </InlineBanner>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md mx-4 animate-scale-in">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Export Alumni</h2>
                <p className="text-sm text-muted-foreground">
                  {exportCount.toLocaleString()} alumni will be exported
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            {/* Field Selection */}
            <div className="p-6">
              {willTruncate && (
                <InlineBanner variant="warning" className="mb-4">
                  {exportCount.toLocaleString()} alumni match, but this export will include only the
                  {" "}
                  first {EXPORT_ROW_LIMIT.toLocaleString()} rows. Narrow filters or export a smaller
                  {" "}
                  selection to download the rest.
                </InlineBanner>
              )}
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                Select fields to include
              </h3>
              <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                {EXPORT_FIELDS.map((field) => (
                  <label
                    key={field.key}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFields.has(field.key)}
                      onChange={() => toggleField(field.key)}
                      className="rounded border-border"
                    />
                    <span className="text-sm text-foreground">{field.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 p-6 border-t border-border bg-muted/30">
              <Button
                className="flex-1"
                onClick={() => handleExport()}
                disabled={isExporting || selectedFields.size === 0}
              >
                {isExporting ? (
                  <LoadingSpinner className="h-4 w-4" />
                ) : (
                  <FileIcon className="h-4 w-4" />
                )}
                Export CSV
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
      />
    </svg>
  );
}

function LoadingSpinner({ className }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
