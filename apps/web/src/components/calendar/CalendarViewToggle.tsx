"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { parseCalendarView } from "@/lib/calendar/view-state";

type ViewMode = "calendar" | "availability";

function MonthGridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.75A2.25 2.25 0 0118 6.25v9.5A2.25 2.25 0 0115.75 18H4.25A2.25 2.25 0 012 15.75v-9.5A2.25 2.25 0 014.25 4H5V2.75A.75.75 0 015.75 2zm-1.5 5.5a.75.75 0 000 1.5h.5a.75.75 0 000-1.5h-.5zm2.75.75a.75.75 0 01.75-.75h.5a.75.75 0 010 1.5h-.5a.75.75 0 01-.75-.75zm3.5-.75a.75.75 0 000 1.5h.5a.75.75 0 000-1.5h-.5zm2.75.75a.75.75 0 01.75-.75h.5a.75.75 0 010 1.5h-.5a.75.75 0 01-.75-.75zM4.25 11a.75.75 0 000 1.5h.5a.75.75 0 000-1.5h-.5zm2.75.75a.75.75 0 01.75-.75h.5a.75.75 0 010 1.5h-.5a.75.75 0 01-.75-.75zm3.5-.75a.75.75 0 000 1.5h.5a.75.75 0 000-1.5h-.5zm2.75.75a.75.75 0 01.75-.75h.5a.75.75 0 010 1.5h-.5a.75.75 0 01-.75-.75zM4.25 14.5a.75.75 0 000 1.5h.5a.75.75 0 000-1.5h-.5zm2.75.75a.75.75 0 01.75-.75h.5a.75.75 0 010 1.5h-.5a.75.75 0 01-.75-.75zm3.5-.75a.75.75 0 000 1.5h.5a.75.75 0 000-1.5h-.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}


function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M4.25 2A2.25 2.25 0 002 4.25v2.5A2.25 2.25 0 004.25 9h2.5A2.25 2.25 0 009 6.75v-2.5A2.25 2.25 0 006.75 2h-2.5zm0 9A2.25 2.25 0 002 13.25v2.5A2.25 2.25 0 004.25 18h2.5A2.25 2.25 0 009 15.75v-2.5A2.25 2.25 0 006.75 11h-2.5zm9-9A2.25 2.25 0 0011 4.25v2.5A2.25 2.25 0 0013.25 9h2.5A2.25 2.25 0 0018 6.75v-2.5A2.25 2.25 0 0015.75 2h-2.5zm0 9A2.25 2.25 0 0011 13.25v2.5A2.25 2.25 0 0013.25 18h2.5A2.25 2.25 0 0018 15.75v-2.5A2.25 2.25 0 0015.75 11h-2.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function CalendarViewToggle() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const currentView: ViewMode = parseCalendarView(searchParams.get("view") || undefined);

  const setView = useCallback(
    (view: ViewMode) => {
      const params = new URLSearchParams(searchParams.toString());
      if (view === "calendar") {
        params.delete("view");
        params.delete("subview");
        params.delete("timeframe");
      } else {
        params.set("view", view);
        params.delete("subview");
        params.delete("timeframe");
      }
      const query = params.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, {
        scroll: false,
      });
    },
    [searchParams, router, pathname]
  );

  const tabs: { view: ViewMode; label: string; shortLabel: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { view: "calendar", label: "Calendar", shortLabel: "Calendar", Icon: MonthGridIcon },
    { view: "availability", label: "Availability", shortLabel: "Avail.", Icon: GridIcon },
  ];

  return (
    <div className="bg-muted/50 rounded-xl p-1 inline-flex">
      <nav className="flex gap-1" aria-label="Calendar views">
        {tabs.map(({ view, label, shortLabel, Icon }) => {
          const isActive = currentView === view;
          return (
            <button
              key={view}
              onClick={() => setView(view)}
              className={`
                flex items-center gap-2 whitespace-nowrap py-2 px-3 sm:px-4 text-sm font-medium rounded-lg
                transition-colors duration-200 touch-manipulation
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring
                ${
                  isActive
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-card/50"
                }
              `}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className={`w-4 h-4 ${isActive ? "text-org-secondary" : ""}`} aria-hidden="true" />
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden text-xs">{shortLabel}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
