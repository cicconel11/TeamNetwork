"use client";

import { useEffect, useRef, useState } from "react";

interface AttachmentMenuProps {
  onSelectPoll: () => void;
  onSelectForm: () => void;
}

export function AttachmentMenu({ onSelectPoll, onSelectForm }: AttachmentMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-label="Attach poll or form"
        aria-expanded={isOpen}
        aria-haspopup="true"
        onClick={() => setIsOpen((prev) => !prev)}
        className="h-10 w-10 rounded-lg bg-muted hover:bg-[var(--border)] transition-colors duration-200
          flex items-center justify-center
          focus-visible:ring-2 focus-visible:ring-[var(--color-org-primary)] focus-visible:outline-none"
      >
        <svg
          className="h-5 w-5 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute bottom-full left-0 mb-2 bg-[var(--card)] rounded-xl border border-[var(--border)] shadow-md p-1 min-w-[160px] animate-fade-in z-50"
          role="menu"
        >
          <button
            role="menuitem"
            onClick={() => {
              onSelectPoll();
              setIsOpen(false);
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[var(--foreground)]
              hover:bg-muted transition-colors duration-200
              focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-org-primary)] focus-visible:outline-none"
          >
            <svg
              className="h-4 w-4 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V8m4 8V4m4 12v-4m4 4V8" />
            </svg>
            Poll
          </button>
          <button
            role="menuitem"
            onClick={() => {
              onSelectForm();
              setIsOpen(false);
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[var(--foreground)]
              hover:bg-muted transition-colors duration-200
              focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-org-primary)] focus-visible:outline-none"
          >
            <svg
              className="h-4 w-4 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
            Form
          </button>
        </div>
      )}
    </div>
  );
}
