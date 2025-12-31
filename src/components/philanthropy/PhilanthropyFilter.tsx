"use client";

import { useState } from "react";
import Link from "next/link";

interface PhilanthropyFilterProps {
  orgSlug: string;
  currentView?: string;
}

export function PhilanthropyFilter({ orgSlug, currentView }: PhilanthropyFilterProps) {
  const [open, setOpen] = useState(false);

  const items = [
    { label: "Upcoming", href: `/${orgSlug}/philanthropy`, value: undefined },
    { label: "Past", href: `/${orgSlug}/philanthropy?view=past`, value: "past" },
  ];

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-border transition-colors"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
        </svg>
        Filter
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute mt-2 w-40 rounded-xl border border-border bg-card shadow-lg z-10">
          <div className="py-1">
            {items.map((item) => {
              const active = item.value === currentView || (!item.value && !currentView);
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`block px-4 py-2 text-sm transition-colors ${
                    active ? "text-white bg-org-primary" : "text-foreground hover:bg-muted"
                  }`}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
