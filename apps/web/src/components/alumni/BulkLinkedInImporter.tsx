"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button, Badge, Card } from "@/components/ui";
import { useFileDrop } from "@/hooks/useFileDrop";
import { summarizeRows, type ImportResultBase } from "@/lib/alumni/import-utils";
import { ImportDropZone } from "./ImportDropZone";
import { ImportPreviewSummary } from "./ImportPreviewSummary";
import { ImportResultBanner } from "./ImportResultBanner";

// ─── Types ───────────────────────────────────────────────────────────────────

type RowPreviewStatus =
  | "valid"
  | "invalid_url"
  | "duplicate"
  | "will_update"
  | "will_skip"
  | "will_create"
  | "quota_blocked"
  | "checking";

interface ParsedRow {
  email: string;
  linkedin_url: string;
  status: RowPreviewStatus;
}

type PreviewStatus = "will_update" | "will_skip" | "quota_blocked" | "will_create";

interface ImportResult extends ImportResultBase {
  preview?: Record<string, PreviewStatus>;
}

interface BulkLinkedInImporterProps {
  organizationId: string;
  onClose?: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<RowPreviewStatus, { label: string; variant: "success" | "warning" | "error" | "muted" }> = {
  valid: { label: "Valid", variant: "muted" },
  will_update: { label: "Will update", variant: "success" },
  will_create: { label: "Will create", variant: "success" },
  will_skip: { label: "Will skip", variant: "warning" },
  quota_blocked: { label: "Quota blocked", variant: "warning" },
  invalid_url: { label: "Invalid URL", variant: "error" },
  duplicate: { label: "Duplicate", variant: "warning" },
  checking: { label: "Checking\u2026", variant: "muted" },
};

const LINKEDIN_URL_PATTERN = /^https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  if (firstLine.includes("\t")) return "\t";
  return ",";
}

function parseSpreadsheetData(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(text);
  const firstLine = lines[0].toLowerCase();
  const startIndex = firstLine.includes("email") && firstLine.includes("linkedin") ? 1 : 0;

  const seenEmails = new Set<string>();
  const rows: ParsedRow[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(delimiter).map((s) => s.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;

    const [email, linkedin_url] = parts;
    const emailKey = email.toLowerCase();

    let status: RowPreviewStatus = "valid";
    if (!LINKEDIN_URL_PATTERN.test(linkedin_url)) {
      status = "invalid_url";
    } else if (seenEmails.has(emailKey)) {
      status = "duplicate";
    }

    seenEmails.add(emailKey);
    rows.push({ email, linkedin_url, status });
  }

  return rows;
}

const INVALID_STATUSES = ["invalid_url", "duplicate"];

// ─── Component ───────────────────────────────────────────────────────────────

export function BulkLinkedInImporter({ organizationId, onClose }: BulkLinkedInImporterProps) {
  const router = useRouter();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const validRows = useMemo(
    () => rows.filter((r) => r.status !== "invalid_url" && r.status !== "duplicate"),
    [rows],
  );

  // ─── Preview (dry run) ──────────────────────────────────────────────────

  const handlePreview = useCallback(
    async (parsedRows: ParsedRow[], shouldOverwrite: boolean) => {
      const toPreview = parsedRows.filter((r) => r.status !== "invalid_url" && r.status !== "duplicate");
      if (toPreview.length === 0) return;

      setIsPreviewing(true);
      setRows((prev) =>
        prev.map((r) =>
          r.status !== "invalid_url" && r.status !== "duplicate"
            ? { ...r, status: "checking" as const }
            : r,
        ),
      );

      try {
        const response = await fetch(
          `/api/organizations/${organizationId}/alumni/import-linkedin?preview=1`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rows: toPreview.map((r) => ({ email: r.email, linkedin_url: r.linkedin_url })),
              overwrite: shouldOverwrite,
              dryRun: true,
            }),
          },
        );

        if (response.ok) {
          const data: ImportResult = await response.json();
          if (data.preview) {
            setRows((prev) =>
              prev.map((r) => {
                if (r.status === "invalid_url" || r.status === "duplicate") return r;
                const previewStatus = data.preview?.[r.email.toLowerCase()];
                return { ...r, status: previewStatus ?? "valid" };
              }),
            );
          }
        } else {
          setRows((prev) =>
            prev.map((r) => (r.status === "checking" ? { ...r, status: "valid" as const } : r)),
          );
        }
      } catch {
        setRows((prev) =>
          prev.map((r) => (r.status === "checking" ? { ...r, status: "valid" as const } : r)),
        );
      } finally {
        setIsPreviewing(false);
      }
    },
    [organizationId],
  );

  // Re-run preview when overwrite toggle changes
  useEffect(() => {
    if (rows.length > 0 && !isImporting && !result) {
      handlePreview(rows, overwrite);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overwrite]);

  // Scroll into view on mount
  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  // ─── File handling ──────────────────────────────────────────────────────

  const processFile = useCallback(
    (file: File) => {
      setResult(null);
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        const parsed = parseSpreadsheetData(text);
        setRows(parsed);
        handlePreview(parsed, overwrite);
      };
      reader.readAsText(file);
    },
    [handlePreview, overwrite],
  );

  const fileDrop = useFileDrop({ onFile: processFile });

  // ─── Import ─────────────────────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    if (validRows.length === 0) return;

    setIsImporting(true);
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/alumni/import-linkedin`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: validRows.map((r) => ({ email: r.email, linkedin_url: r.linkedin_url })),
            overwrite,
          }),
        },
      );

      const data: ImportResult = await response.json();
      setResult(data);
      if (data.created > 0 || data.updated > 0) {
        router.refresh();
      }
    } catch {
      setResult({
        updated: 0,
        created: 0,
        skipped: 0,
        quotaBlocked: 0,
        errors: ["Network error. Please try again."],
      });
    } finally {
      setIsImporting(false);
    }
  }, [organizationId, router, validRows, overwrite]);

  // ─── Reset ──────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    setRows([]);
    setResult(null);
    setOverwrite(false);
    fileDrop.resetFileInput();
  }, [fileDrop]);

  // ─── Summary ────────────────────────────────────────────────────────────

  const summary = useMemo(() => summarizeRows(rows, INVALID_STATUSES), [rows]);
  const actionableCount = summary.willUpdate + summary.willCreate;
  const importDisabled = actionableCount === 0 || isImporting || isPreviewing;

  return (
    <Card ref={panelRef} padding="none" className="mb-6 overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-org-secondary/10">
            <svg className="h-4 w-4 text-org-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Bulk Import LinkedIn URLs</h3>
            <p className="text-xs text-muted-foreground">Upload a CSV or TSV file with email and LinkedIn URL columns</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150"
            aria-label="Close import panel"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="px-5 py-4 space-y-4">
        <ImportDropZone fileDrop={fileDrop} hint="Upload CSV or TSV with email and LinkedIn URL columns" />

        {/* Preview table */}
        {rows.length > 0 && !result && (
          <>
            <ImportPreviewSummary
              summary={summary}
              isPreviewing={isPreviewing}
              previewingText="Checking emails against alumni records\u2026"
            />

            {/* Table */}
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Email</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">LinkedIn URL</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row, i) => {
                    const badge = STATUS_BADGE[row.status];
                    return (
                      <tr
                        key={i}
                        className={
                          row.status === "invalid_url"
                            ? "bg-red-500/5"
                            : row.status === "quota_blocked"
                              ? "opacity-50"
                              : ""
                        }
                      >
                        <td className="px-3 py-2 font-mono text-xs text-foreground">{row.email}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground truncate max-w-[240px]">
                          {row.linkedin_url}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-1">
              <Button
                size="sm"
                onClick={handleImport}
                disabled={importDisabled}
                isLoading={isImporting}
              >
                {isImporting
                  ? "Importing\u2026"
                  : `Import ${actionableCount} Record${actionableCount !== 1 ? "s" : ""}`}
              </Button>
              <Button size="sm" variant="ghost" onClick={handleReset}>
                Reset
              </Button>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none ml-auto">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                  disabled={isImporting}
                  className="rounded border-border"
                />
                Overwrite existing URLs
              </label>
            </div>
            {summary.quotaBlocked > 0 && (
              <p className="text-xs text-amber-300">
                Some rows are valid, but they are quota blocked because this organization has no alumni capacity remaining.
              </p>
            )}
          </>
        )}

        {/* Result banner */}
        {result && (
          <ImportResultBanner result={result} onReset={handleReset} onClose={onClose} />
        )}
      </div>
    </Card>
  );
}
