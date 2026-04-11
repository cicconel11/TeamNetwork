"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface AddAlumniMenuProps {
  orgSlug: string;
  actionLabel: string;
  onSingleLinkedInClick: () => void;
  onImportClick: () => void;
  onCsvImportClick: () => void;
  selectMode?: boolean;
  onToggleSelectMode?: () => void;
}

const SHARED_BUTTON =
  "inline-flex items-center justify-center text-sm font-medium bg-org-secondary text-org-secondary-foreground hover:opacity-90 transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-org-secondary focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-pointer";

export function AddAlumniMenu({
  orgSlug,
  actionLabel,
  onSingleLinkedInClick,
  onImportClick,
  onCsvImportClick,
  selectMode,
  onToggleSelectMode,
}: AddAlumniMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    },
    [],
  );

  return (
    <div ref={menuRef} className="relative" onKeyDown={handleKeyDown}>
      {/* Split button — single rounded-xl container, two buttons inside */}
      <div className="flex items-stretch rounded-xl overflow-hidden">
        <button
          className={`${SHARED_BUTTON} gap-2 px-4 py-2.5`}
          data-testid="alumni-new-link"
          onClick={() => router.push(`/${orgSlug}/alumni/new`)}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {actionLabel}
        </button>

        <div className="w-px bg-white/20" />

        <button
          className={`${SHARED_BUTTON} px-2.5 py-2.5`}
          onClick={() => setIsOpen((prev) => !prev)}
          aria-haspopup="true"
          aria-expanded={isOpen}
          aria-label="More add options"
        >
          <svg
            className={`h-4 w-4 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      </div>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-56 rounded-xl bg-card border border-border shadow-lg z-20 overflow-hidden animate-fade-in"
        >
          <button
            role="menuitem"
            className="w-full text-left px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors duration-150 flex items-center gap-3"
            onClick={() => {
              setIsOpen(false);
              onSingleLinkedInClick();
            }}
          >
            <svg className="h-4 w-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75v10.5m-10.5-10.5v10.5M12 3v18m8.25-8.25H3.75" />
            </svg>
            Attach LinkedIn URL
          </button>
          <div className="border-t border-border" />
          <button
            role="menuitem"
            className="w-full text-left px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors duration-150 flex items-center gap-3"
            onClick={() => {
              setIsOpen(false);
              router.push(`/${orgSlug}/alumni/new`);
            }}
          >
            <svg className="h-4 w-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
            </svg>
            Add Single Alumni
          </button>
          <div className="border-t border-border" />
          <button
            role="menuitem"
            className="w-full text-left px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors duration-150 flex items-center gap-3"
            onClick={() => {
              setIsOpen(false);
              onImportClick();
            }}
          >
            <svg className="h-4 w-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            Bulk Import LinkedIn URLs
          </button>
          <div className="border-t border-border" />
          <button
            role="menuitem"
            className="w-full text-left px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors duration-150 flex items-center gap-3"
            onClick={() => {
              setIsOpen(false);
              onCsvImportClick();
            }}
          >
            <svg className="h-4 w-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0 1 18 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0 1 18 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 0 1 6 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M7.125 15h2.25m-2.25 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125h2.25m-2.25 0v-3.375m2.25 3.375v-3.375m0 3.375c0 .621.504 1.125 1.125 1.125h1.5m-2.625-1.125v-2.25m2.625 3.375h1.5m0-3.375c0-.621.504-1.125 1.125-1.125m-1.5 0h-1.5m1.5 0c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125m0-3.375h-1.5m1.5 3.375c-.621 0-1.125-.504-1.125-1.125v-2.25m0 3.375h-2.25" />
            </svg>
            Import CSV / Spreadsheet
          </button>
          {onToggleSelectMode && (
            <>
              <div className="border-t border-border" />
              <button
                role="menuitem"
                className="w-full text-left px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors duration-150 flex items-center gap-3"
                onClick={() => {
                  setIsOpen(false);
                  onToggleSelectMode();
                }}
              >
                <svg className="h-4 w-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  {selectMode ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  )}
                </svg>
                {selectMode ? "Exit Selection Mode" : "Select for Bulk Delete"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
