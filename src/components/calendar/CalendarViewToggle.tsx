"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { parseCalendarView } from "@/lib/calendar/view-state";

type ViewMode = "events" | "all" | "availability";

function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M2 3.75A.75.75 0 012.75 3h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 3.75zm0 4.167a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75zm0 4.166a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75zm0 4.167a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"
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

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M6 2a.75.75 0 01.75.75V3h6.5v-.25a.75.75 0 011.5 0V3h.75A2.25 2.25 0 0118 5.25v9.5A2.25 2.25 0 0115.75 17h-11.5A2.25 2.25 0 012 14.75v-9.5A2.25 2.25 0 014.25 3H5v-.25A.75.75 0 016 2zm10.5 6.25h-13v6.5c0 .414.336.75.75.75h11.5a.75.75 0 00.75-.75v-6.5z" />
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
      if (view === "events") {
        params.delete("view");
      } else {
        params.set("view", view);
      }
      const query = params.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, {
        scroll: false,
      });
    },
    [searchParams, router, pathname]
  );

  return (
    <div className="bg-muted/50 rounded-xl p-1 inline-flex">
      <nav className="flex gap-1" aria-label="Calendar views">
        <button
          onClick={() => setView("events")}
          className={`
            flex items-center gap-2 whitespace-nowrap py-2.5 px-4 text-sm font-medium rounded-lg
            transition-colors duration-200 touch-manipulation
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring
            ${
              currentView === "events"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-card/50"
            }
          `}
          aria-current={currentView === "events" ? "page" : undefined}
        >
          <CalendarIcon
            className={`w-4 h-4 ${currentView === "events" ? "text-org-secondary" : ""}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">Events</span>
          <span className="sm:hidden sr-only">Events view</span>
        </button>

        <button
          onClick={() => setView("all")}
          className={`
            flex items-center gap-2 whitespace-nowrap py-2.5 px-4 text-sm font-medium rounded-lg
            transition-colors duration-200 touch-manipulation
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring
            ${
              currentView === "all"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-card/50"
            }
          `}
          aria-current={currentView === "all" ? "page" : undefined}
        >
          <ListIcon
            className={`w-4 h-4 ${currentView === "all" ? "text-org-secondary" : ""}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">All Activity</span>
          <span className="sm:hidden sr-only">All activity view</span>
        </button>

        <button
          onClick={() => setView("availability")}
          className={`
            flex items-center gap-2 whitespace-nowrap py-2.5 px-4 text-sm font-medium rounded-lg
            transition-colors duration-200 touch-manipulation
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring
            ${
              currentView === "availability"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-card/50"
            }
          `}
          aria-current={currentView === "availability" ? "page" : undefined}
        >
          <GridIcon
            className={`w-4 h-4 ${currentView === "availability" ? "text-org-secondary" : ""}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">Availability</span>
          <span className="sm:hidden sr-only">Availability view</span>
        </button>
      </nav>
    </div>
  );
}
