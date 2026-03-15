/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button, Badge, Card } from "@/components/ui";
import { parseCsvData, generateCsvTemplate, type CsvImportRow, type CsvImportPreviewStatus } from "@/lib/alumni/csv-import";
import { useFileDrop } from "@/hooks/useFileDrop";
import { summarizeRows, type ImportResultBase } from "@/lib/alumni/import-utils";
import { ImportDropZone } from "./ImportDropZone";
import { ImportPasteArea } from "./ImportPasteArea";
import { ImportPreviewSummary } from "./ImportPreviewSummary";
import { ImportResultBanner } from "./ImportResultBanner";

// ─── Types ───────────────────────────────────────────────────────────────────

type RowStatus =
  | "will_create"
  | "will_update"
  | "will_skip"
  | "quota_blocked"
  | "duplicate"
  | "invalid"
  | "checking";

interface DisplayRow extends CsvImportRow {
  status: RowStatus;
  rowIndex: number;
}

interface ImportResult extends ImportResultBase {
  preview?: Record<string, CsvImportPreviewStatus>;
  emailsSent?: number;
  emailErrors?: number;
}

interface BulkCsvImporterProps {
  organizationId: string;
  onClose?: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<RowStatus, { label: string; variant: "success" | "warning" | "error" | "muted" }> = {
  will_create: { label: "Will create", variant: "success" },
  will_update: { label: "Will update", variant: "success" },
  will_skip: { label: "Will skip", variant: "warning" },
  quota_blocked: { label: "Quota blocked", variant: "warning" },
  duplicate: { label: "Duplicate", variant: "warning" },
  invalid: { label: "Invalid", variant: "error" },
  checking: { label: "Checking\u2026", variant: "muted" },
};

const INVALID_STATUSES = ["invalid", "duplicate"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parsedRowsToDisplay(rows: CsvImportRow[]): DisplayRow[] {
  return rows.map((row, i) => ({
    ...row,
    status: "checking" as const,
    rowIndex: i,
  }));
}

function downloadCsvTemplate() {
  const csv = generateCsvTemplate();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "alumni-import-template.csv";
  link.click();
  // Delay revocation so the browser can fetch the blob before it's freed
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function BulkCsvImporter({ organizationId, onClose }: BulkCsvImporterProps) {
  const router = useRouter();
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [sendInvites, setSendInvites] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const validRows = useMemo(
    () => rows.filter((r) => r.status !== "invalid" && r.status !== "duplicate"),
    [rows],
  );

  const hasEmailRows = useMemo(
    () => rows.some((r) => r.email && r.status !== "invalid" && r.status !== "duplicate"),
    [rows],
  );

  // ─── Preview (dry run) ──────────────────────────────────────────────────

  const handlePreview = useCallback(
    async (displayRows: DisplayRow[], shouldOverwrite: boolean) => {
      const toPreview = displayRows.filter((r) => r.status !== "invalid" && r.status !== "duplicate");
      if (toPreview.length === 0) return;

      setIsPreviewing(true);
      setRows((prev) =>
        prev.map((r) =>
          r.status !== "invalid" && r.status !== "duplicate"
            ? { ...r, status: "checking" as const }
            : r,
        ),
      );

      try {
        const response = await fetch(
          `/api/organizations/${organizationId}/alumni/import-csv?preview=1`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rows: toPreview.map(({ status: _s, rowIndex: _i, ...rest }) => rest),
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
                if (r.status === "invalid" || r.status === "duplicate") return r;
                const previewStatus = data.preview?.[`row:${r.rowIndex}`];
                return { ...r, status: (previewStatus as RowStatus) ?? "will_create" };
              }),
            );
          }
        } else {
          setRows((prev) =>
            prev.map((r) => (r.status === "checking" ? { ...r, status: "will_create" as const } : r)),
          );
        }
      } catch {
        setRows((prev) =>
          prev.map((r) => (r.status === "checking" ? { ...r, status: "will_create" as const } : r)),
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

  const processText = useCallback(
    (text: string) => {
      setResult(null);
      const parsed = parseCsvData(text);
      const display = parsedRowsToDisplay(parsed);
      setRows(display);
      handlePreview(display, overwrite);
    },
    [handlePreview, overwrite],
  );

  const processFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        processText(text);
      };
      reader.readAsText(file);
    },
    [processText],
  );

  const fileDrop = useFileDrop({ onFile: processFile });

  const handlePasteSubmit = useCallback(() => {
    if (!fileDrop.pasteText.trim()) return;
    processText(fileDrop.pasteText);
  }, [processText, fileDrop.pasteText]);

  // ─── Import ─────────────────────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    if (validRows.length === 0) return;

    setIsImporting(true);
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/alumni/import-csv`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: validRows.map(({ status: _s, rowIndex: _i, ...rest }) => rest),
            overwrite,
            dryRun: false,
            sendInvites,
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
  }, [organizationId, validRows, overwrite, sendInvites]);

  // ─── Reset ──────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    setRows([]);
    setResult(null);
    setOverwrite(false);
    setSendInvites(false);
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
            <h3 className="text-sm font-semibold text-foreground">Import Alumni from CSV</h3>
            <p className="text-xs text-muted-foreground">Upload a CSV or spreadsheet with alumni details</p>
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
        {/* Template download */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={downloadCsvTemplate}
            className="inline-flex items-center gap-1.5 text-xs text-org-secondary hover:text-org-secondary/80 transition-colors duration-150"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download template
          </button>
        </div>

        <ImportDropZone fileDrop={fileDrop} hint="CSV or TSV — first row must be column headers" />

        <ImportPasteArea
          showPaste={fileDrop.showPaste}
          pasteText={fileDrop.pasteText}
          placeholder={"first_name\tlast_name\temail\nJane\tSmith\tjane@example.com"}
          onToggle={() => fileDrop.setShowPaste((v) => !v)}
          onChange={fileDrop.setPasteText}
          onSubmit={handlePasteSubmit}
        />

        {/* Preview table */}
        {rows.length > 0 && !result && (
          <>
            <ImportPreviewSummary summary={summary} isPreviewing={isPreviewing} />

            {/* Horizontally scrollable table */}
            <div className="max-h-64 overflow-y-auto overflow-x-auto rounded-lg border border-border">
              <table className="min-w-max text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">First Name</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Last Name</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Email</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Grad Year</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Industry</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Company</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">City</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Position</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">LinkedIn</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => {
                    const badge = STATUS_BADGE[row.status];
                    return (
                      <tr
                        key={row.rowIndex}
                        className={
                          row.status === "invalid"
                            ? "bg-red-500/5"
                            : row.status === "quota_blocked"
                              ? "opacity-50"
                              : ""
                        }
                      >
                        <td className="px-3 py-2 text-xs text-foreground whitespace-nowrap">{row.first_name}</td>
                        <td className="px-3 py-2 text-xs text-foreground whitespace-nowrap">{row.last_name}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">{row.email ?? ""}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{row.graduation_year ?? ""}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{row.industry ?? ""}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{row.current_company ?? ""}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{row.current_city ?? ""}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{row.position_title ?? ""}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground max-w-[160px] truncate whitespace-nowrap">
                          {row.linkedin_url ?? ""}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Action controls */}
            <div className="flex items-center gap-3 pt-1 flex-wrap">
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
              <div className="ml-auto flex flex-col gap-1.5">
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={overwrite}
                    onChange={(e) => setOverwrite(e.target.checked)}
                    disabled={isImporting}
                    className="rounded border-border"
                  />
                  Overwrite existing data
                </label>
                <label className={`flex items-center gap-2 text-xs cursor-pointer select-none ${hasEmailRows ? "text-muted-foreground" : "text-muted-foreground/40 cursor-not-allowed"}`}>
                  <input
                    type="checkbox"
                    checked={sendInvites}
                    onChange={(e) => setSendInvites(e.target.checked)}
                    disabled={isImporting || !hasEmailRows}
                    className="rounded border-border"
                  />
                  Send invite emails to new alumni
                </label>
                {sendInvites && (
                  <p className="text-xs text-muted-foreground/70 max-w-xs">
                    Alumni with email addresses will receive an invitation to claim their profile.
                  </p>
                )}
              </div>
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
          <ImportResultBanner
            result={result}
            onReset={handleReset}
            onClose={onClose}
            extraDetail={
              result.emailsSent !== undefined ? (
                <p className="text-xs text-muted-foreground mt-1">
                  {result.emailErrors
                    ? `${result.emailsSent} invite email${result.emailsSent !== 1 ? "s" : ""} sent, ${result.emailErrors} failed`
                    : `${result.emailsSent} invite email${result.emailsSent !== 1 ? "s" : ""} sent`}
                </p>
              ) : undefined
            }
          />
        )}
      </div>
    </Card>
  );
}
