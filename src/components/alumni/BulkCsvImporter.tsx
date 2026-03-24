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

interface CreatedAlumniRecord {
  id: string;
  email?: string;
  firstName: string;
  lastName: string;
}

interface ImportResult extends ImportResultBase {
  preview?: Record<string, CsvImportPreviewStatus>;
  emailsSent?: number;
  emailErrors?: number;
  createdRecords?: CreatedAlumniRecord[];
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
const NON_SELECTABLE_STATUSES = new Set<string>(["invalid", "duplicate"]);

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

  // Feature A: Preview row selection + exclusion
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [excludedIndices, setExcludedIndices] = useState<Set<number>>(new Set());

  // Feature B: Post-import selection + deletion
  const [postImportSelected, setPostImportSelected] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteCount, setDeleteCount] = useState(0);

  // ─── Derived state (filters out excluded rows) ────────────────────────────

  const activeRows = useMemo(
    () => rows.filter((r) => !excludedIndices.has(r.rowIndex)),
    [rows, excludedIndices],
  );

  const validRows = useMemo(
    () => activeRows.filter((r) => r.status !== "invalid" && r.status !== "duplicate"),
    [activeRows],
  );

  const hasEmailRows = useMemo(
    () => activeRows.some((r) => r.email && r.status !== "invalid" && r.status !== "duplicate"),
    [activeRows],
  );

  const selectableIndices = useMemo(
    () => new Set(
      rows
        .filter((r) => !excludedIndices.has(r.rowIndex) && !NON_SELECTABLE_STATUSES.has(r.status))
        .map((r) => r.rowIndex)
    ),
    [rows, excludedIndices],
  );

  const allSelectableChecked = selectableIndices.size > 0 && [...selectableIndices].every((i) => selectedIndices.has(i));
  const someSelectableChecked = [...selectableIndices].some((i) => selectedIndices.has(i));

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
    if (activeRows.length > 0 && !isImporting && !result) {
      handlePreview(activeRows, overwrite);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overwrite]);

  // Scroll into view on mount
  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  // ─── Selection handlers ───────────────────────────────────────────────

  const toggleRowSelection = useCallback((rowIndex: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) {
        next.delete(rowIndex);
      } else {
        next.add(rowIndex);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (allSelectableChecked) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(selectableIndices));
    }
  }, [allSelectableChecked, selectableIndices]);

  const handleRemoveSelected = useCallback(() => {
    if (selectedIndices.size === 0) return;
    const newExcluded = new Set(excludedIndices);
    for (const idx of selectedIndices) {
      newExcluded.add(idx);
    }
    setExcludedIndices(newExcluded);
    setSelectedIndices(new Set());

    // Re-run preview with remaining rows
    const remaining = rows.filter((r) => !newExcluded.has(r.rowIndex));
    if (remaining.length > 0) {
      handlePreview(remaining, overwrite);
    }
  }, [selectedIndices, excludedIndices, rows, handlePreview, overwrite]);

  const handleRestoreRow = useCallback((rowIndex: number) => {
    setExcludedIndices((prev) => {
      const next = new Set(prev);
      next.delete(rowIndex);
      return next;
    });
    // Re-run preview after restore
    const remaining = rows.filter((r) => !excludedIndices.has(r.rowIndex) || r.rowIndex === rowIndex);
    handlePreview(remaining, overwrite);
  }, [rows, excludedIndices, handlePreview, overwrite]);

  // ─── File handling ──────────────────────────────────────────────────────

  const processText = useCallback(
    (text: string) => {
      setResult(null);
      setSelectedIndices(new Set());
      setExcludedIndices(new Set());
      setPostImportSelected(new Set());
      setDeleteCount(0);
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
  }, [organizationId, validRows, overwrite, sendInvites, router]);

  // ─── Post-import bulk delete ──────────────────────────────────────────

  const handleBulkDelete = useCallback(async () => {
    if (postImportSelected.size === 0) return;
    const count = postImportSelected.size;
    if (!window.confirm(`Delete ${count} alumni record${count !== 1 ? "s" : ""}? This action can be undone by an admin.`)) return;

    setIsDeleting(true);
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/alumni/bulk-delete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alumniIds: [...postImportSelected] }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        setDeleteCount((prev) => prev + data.deleted);
        // Remove deleted records from the result
        setResult((prev) =>
          prev
            ? {
                ...prev,
                createdRecords: prev.createdRecords?.filter(
                  (r) => !postImportSelected.has(r.id)
                ),
              }
            : null
        );
        setPostImportSelected(new Set());
        router.refresh();
      }
    } catch {
      // Network error — selection preserved so user can retry
    } finally {
      setIsDeleting(false);
    }
  }, [organizationId, postImportSelected, router]);

  // ─── Reset ──────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    setRows([]);
    setResult(null);
    setOverwrite(false);
    setSendInvites(false);
    setSelectedIndices(new Set());
    setExcludedIndices(new Set());
    setPostImportSelected(new Set());
    setDeleteCount(0);
    fileDrop.resetFileInput();
  }, [fileDrop]);

  // ─── Summary ────────────────────────────────────────────────────────────

  const summary = useMemo(() => summarizeRows(activeRows, INVALID_STATUSES), [activeRows]);
  const actionableCount = summary.willUpdate + summary.willCreate;
  const importDisabled = actionableCount === 0 || isImporting || isPreviewing;

  // ─── Post-import selection helpers ────────────────────────────────────

  const createdRecords = result?.createdRecords ?? [];
  const allPostImportChecked = createdRecords.length > 0 && createdRecords.every((r) => postImportSelected.has(r.id));
  const somePostImportChecked = createdRecords.some((r) => postImportSelected.has(r.id));

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

            {excludedIndices.size > 0 && (
              <p className="text-xs text-muted-foreground">
                {excludedIndices.size} row{excludedIndices.size !== 1 ? "s" : ""} excluded from import
              </p>
            )}

            {/* Horizontally scrollable table with checkbox column */}
            <div className="max-h-64 overflow-y-auto overflow-x-auto rounded-lg border border-border">
              <table className="min-w-max text-sm">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr>
                    <th className="sticky left-0 z-20 bg-muted/50 px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={allSelectableChecked}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelectableChecked && !allSelectableChecked;
                        }}
                        onChange={toggleSelectAll}
                        disabled={isImporting || selectableIndices.size === 0}
                        className="rounded border-border"
                        aria-label="Select all rows"
                      />
                    </th>
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
                    const isExcluded = excludedIndices.has(row.rowIndex);
                    const isSelectable = selectableIndices.has(row.rowIndex);
                    const badge = STATUS_BADGE[row.status];
                    return (
                      <tr
                        key={row.rowIndex}
                        className={
                          isExcluded
                            ? "opacity-40"
                            : row.status === "invalid"
                              ? "bg-red-500/5"
                              : row.status === "quota_blocked"
                                ? "opacity-50"
                                : ""
                        }
                      >
                        <td className="sticky left-0 z-10 bg-card px-3 py-2 w-8">
                          {isExcluded ? (
                            <button
                              onClick={() => handleRestoreRow(row.rowIndex)}
                              className="text-[10px] text-org-secondary hover:text-org-secondary/80 whitespace-nowrap"
                            >
                              Restore
                            </button>
                          ) : isSelectable ? (
                            <input
                              type="checkbox"
                              checked={selectedIndices.has(row.rowIndex)}
                              onChange={() => toggleRowSelection(row.rowIndex)}
                              disabled={isImporting}
                              className="rounded border-border"
                              aria-label={`Select ${row.first_name} ${row.last_name}`}
                            />
                          ) : null}
                        </td>
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
                          {isExcluded ? (
                            <Badge variant="muted">Excluded</Badge>
                          ) : (
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                          )}
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
              {selectedIndices.size > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleRemoveSelected}
                  disabled={isImporting}
                >
                  Remove {selectedIndices.size} Selected
                </Button>
              )}
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
          <>
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

            {/* Post-import: created records with bulk delete */}
            {createdRecords.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-medium text-muted-foreground">
                    Created Records ({createdRecords.length})
                    {deleteCount > 0 && (
                      <span className="ml-2 text-amber-400">{deleteCount} deleted</span>
                    )}
                  </h4>
                  {postImportSelected.size > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleBulkDelete}
                      disabled={isDeleting}
                      isLoading={isDeleting}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      {isDeleting
                        ? "Deleting\u2026"
                        : `Delete ${postImportSelected.size} Selected`}
                    </Button>
                  )}
                </div>

                <div className="max-h-48 overflow-y-auto overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 w-8">
                          <input
                            type="checkbox"
                            checked={allPostImportChecked}
                            ref={(el) => {
                              if (el) el.indeterminate = somePostImportChecked && !allPostImportChecked;
                            }}
                            onChange={() => {
                              if (allPostImportChecked) {
                                setPostImportSelected(new Set());
                              } else {
                                setPostImportSelected(new Set(createdRecords.map((r) => r.id)));
                              }
                            }}
                            disabled={isDeleting}
                            className="rounded border-border"
                            aria-label="Select all created records"
                          />
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Name</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Email</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {createdRecords.map((record) => (
                        <tr key={record.id}>
                          <td className="px-3 py-2 w-8">
                            <input
                              type="checkbox"
                              checked={postImportSelected.has(record.id)}
                              onChange={() => {
                                setPostImportSelected((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(record.id)) {
                                    next.delete(record.id);
                                  } else {
                                    next.add(record.id);
                                  }
                                  return next;
                                });
                              }}
                              disabled={isDeleting}
                              className="rounded border-border"
                              aria-label={`Select ${record.firstName} ${record.lastName}`}
                            />
                          </td>
                          <td className="px-3 py-2 text-xs text-foreground whitespace-nowrap">
                            {record.firstName} {record.lastName}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                            {record.email ?? ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
