"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Avatar, Button } from "@/components/ui";
import { DirectoryCardLink } from "@/components/analytics/DirectoryCardLink";
import { LinkedInBadge } from "@/components/shared";
import { useAlumniSelectMode } from "./AlumniActions";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AlumniRecord {
  id: string;
  first_name: string;
  last_name: string;
  photo_url: string | null;
  position_title: string | null;
  job_title: string | null;
  current_company: string | null;
  graduation_year: number | null;
  industry: string | null;
  current_city: string | null;
  linkedin_url: string | null;
}

interface AlumniSelectableGridProps {
  alumni: AlumniRecord[];
  orgSlug: string;
  organizationId: string;
}

const MAX_DELETE = 500;

// ─── Component ──────────────────────────────────────────────────────────────

export function AlumniSelectableGrid({ alumni, orgSlug, organizationId }: AlumniSelectableGridProps) {
  const router = useRouter();
  const { selectMode, toggleSelectMode } = useAlumniSelectMode();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear selection when exiting select mode
  const handleExitSelectMode = useCallback(() => {
    setSelectedIds(new Set());
    setDeleteError(null);
    setConfirmDelete(false);
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    toggleSelectMode();
  }, [toggleSelectMode]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === alumni.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(alumni.map((a) => a.id)));
    }
  }, [selectedIds.size, alumni]);

  // ─── Inline delete confirmation ─────────────────────────────────────────

  const handleDeleteClick = useCallback(() => {
    if (selectedIds.size === 0) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      confirmTimeoutRef.current = setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    setConfirmDelete(false);
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    void executeDelete();
  }, [selectedIds, confirmDelete]); // eslint-disable-line react-hooks/exhaustive-deps

  const executeDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/alumni/bulk-delete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alumniIds: [...selectedIds] }),
        },
      );
      const data = await response.json();
      if (response.ok) {
        setSelectedIds(new Set());
        setConfirmDelete(false);
        toggleSelectMode();
        router.refresh();
      } else {
        setDeleteError(data.error ?? "Failed to delete records");
      }
    } catch {
      setDeleteError("Network error. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  }, [organizationId, selectedIds, router, toggleSelectMode]);

  const overLimit = selectedIds.size > MAX_DELETE;

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <>
      {/* Selection toolbar */}
      {selectMode && (
        <div className="flex items-center gap-3 px-4 py-3 mb-4 rounded-xl bg-org-secondary/5 border border-org-secondary/20 animate-fade-in">
          <span className="text-sm font-medium text-org-secondary">
            {selectedIds.size > 0
              ? `${selectedIds.size} of ${alumni.length} selected`
              : "Click cards to select"}
          </span>

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={toggleSelectAll}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
            >
              {selectedIds.size === alumni.length ? "Deselect all" : "Select all"}
            </button>

            {selectedIds.size > 0 && (
              <>
                {overLimit && (
                  <span className="text-xs text-amber-500">Max {MAX_DELETE} at a time</span>
                )}
                <Button
                  size="sm"
                  variant={confirmDelete ? "danger" : "ghost"}
                  onClick={handleDeleteClick}
                  disabled={isDeleting || overLimit}
                  isLoading={isDeleting}
                  className={confirmDelete ? "" : "text-red-500 hover:text-red-400 hover:bg-red-500/10"}
                >
                  {isDeleting
                    ? "Deleting\u2026"
                    : confirmDelete
                      ? `Confirm Delete ${selectedIds.size}?`
                      : `Delete ${selectedIds.size} Selected`}
                </Button>
                {confirmDelete && (
                  <button
                    onClick={() => { setConfirmDelete(false); if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current); }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
                  >
                    Cancel
                  </button>
                )}
              </>
            )}

            <div className="w-px h-5 bg-border mx-1" />
            <button
              onClick={handleExitSelectMode}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
            >
              Exit selection
            </button>
          </div>
        </div>
      )}

      {/* Error banner */}
      {deleteError && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2 mb-4 animate-fade-in">
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          {deleteError}
        </div>
      )}

      {/* Alumni card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
        {alumni.map((alum) => {
          const isSelected = selectedIds.has(alum.id);

          return (
            <Card
              key={alum.id}
              interactive={!selectMode}
              className={`p-5 transition-all duration-150 ${
                selectMode
                  ? `cursor-pointer ${isSelected ? "ring-2 ring-org-secondary bg-org-secondary/5" : "hover:ring-1 hover:ring-org-secondary/30"}`
                  : ""
              }`}
              data-testid="alumni-row"
              onClick={selectMode ? () => toggleSelection(alum.id) : undefined}
            >
              <div className="flex items-center gap-4">
                {selectMode && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelection(alum.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-border accent-emerald-500 shrink-0"
                    aria-label={`Select ${alum.first_name} ${alum.last_name}`}
                  />
                )}
                {selectMode ? (
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <Avatar
                      src={alum.photo_url}
                      name={`${alum.first_name} ${alum.last_name}`}
                      size="lg"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">
                        {alum.first_name} {alum.last_name}
                      </h3>
                      {(alum.position_title || alum.job_title) && (
                        <p className="text-sm text-muted-foreground truncate">
                          {alum.position_title || alum.job_title}
                          {alum.current_company && ` at ${alum.current_company}`}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {alum.graduation_year && (
                          <Badge variant="muted">Class of {alum.graduation_year}</Badge>
                        )}
                        {alum.industry && (
                          <Badge variant="primary">{alum.industry}</Badge>
                        )}
                        {alum.current_city && (
                          <span className="text-xs text-muted-foreground truncate">
                            {alum.current_city}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <DirectoryCardLink
                    href={`/${orgSlug}/alumni/${alum.id}`}
                    organizationId={organizationId}
                    directoryType="alumni"
                    className="flex min-w-0 flex-1 items-center gap-4"
                  >
                    <Avatar
                      src={alum.photo_url}
                      name={`${alum.first_name} ${alum.last_name}`}
                      size="lg"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">
                        {alum.first_name} {alum.last_name}
                      </h3>
                      {(alum.position_title || alum.job_title) && (
                        <p className="text-sm text-muted-foreground truncate">
                          {alum.position_title || alum.job_title}
                          {alum.current_company && ` at ${alum.current_company}`}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {alum.graduation_year && (
                          <Badge variant="muted">Class of {alum.graduation_year}</Badge>
                        )}
                        {alum.industry && (
                          <Badge variant="primary">{alum.industry}</Badge>
                        )}
                        {alum.current_city && (
                          <span className="text-xs text-muted-foreground truncate">
                            {alum.current_city}
                          </span>
                        )}
                      </div>
                    </div>
                  </DirectoryCardLink>
                )}
                <LinkedInBadge linkedinUrl={alum.linkedin_url} className="shrink-0" />
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
