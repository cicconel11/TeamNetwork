"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";

type ViewMode = "list" | "availability";

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

export function CalendarViewToggle() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const currentView: ViewMode =
    searchParams.get("view") === "availability" ? "availability" : "list";

  const setView = useCallback(
    (view: ViewMode) => {
      const params = new URLSearchParams(searchParams.toString());
      if (view === "list") {
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
          onClick={() => setView("list")}
          className={`
            flex items-center gap-2 whitespace-nowrap py-2.5 px-4 text-sm font-medium rounded-lg
            transition-colors duration-200 touch-manipulation
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring
            ${
              currentView === "list"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-card/50"
            }
          `}
          aria-current={currentView === "list" ? "page" : undefined}
        >
          <ListIcon
            className={`w-4 h-4 ${currentView === "list" ? "text-org-secondary" : ""}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">List</span>
          <span className="sm:hidden sr-only">List view</span>
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
