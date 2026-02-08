"use client";

import { useState, type ReactNode, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { TeamScheduleTab } from "./TeamScheduleTab";
import { UpcomingEventsTab } from "./UpcomingEventsTab";
import { MyCalendarTab } from "./MyCalendarTab";
import { AvailabilityTab } from "./AvailabilityTab";
import type { AcademicSchedule, User } from "@/types/database";
import type { NavConfig } from "@/lib/navigation/nav-items";

type TabId = "team" | "upcoming" | "calendar" | "availability";

type Tab = {
  id: TabId;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
};

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z" clipRule="evenodd" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
    </svg>
  );
}

function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 002 4.25v2.5A2.25 2.25 0 004.25 9h2.5A2.25 2.25 0 009 6.75v-2.5A2.25 2.25 0 006.75 2h-2.5zm0 9A2.25 2.25 0 002 13.25v2.5A2.25 2.25 0 004.25 18h2.5A2.25 2.25 0 009 15.75v-2.5A2.25 2.25 0 006.75 11h-2.5zm9-9A2.25 2.25 0 0011 4.25v2.5A2.25 2.25 0 0013.25 9h2.5A2.25 2.25 0 0018 6.75v-2.5A2.25 2.25 0 0015.75 2h-2.5zm0 9A2.25 2.25 0 0011 13.25v2.5A2.25 2.25 0 0013.25 18h2.5A2.25 2.25 0 0018 15.75v-2.5A2.25 2.25 0 0015.75 11h-2.5z" clipRule="evenodd" />
    </svg>
  );
}

const TABS: Tab[] = [
  { id: "team", label: "Team Schedule", icon: <CalendarIcon className="w-4 h-4" /> },
  { id: "upcoming", label: "Upcoming", icon: <ClockIcon className="w-4 h-4" /> },
  { id: "calendar", label: "My Calendar", icon: <UserIcon className="w-4 h-4" /> },
  { id: "availability", label: "Availability", icon: <GridIcon className="w-4 h-4" /> },
];

type SchedulesTabsProps = {
  orgId: string;
  orgSlug: string;
  isAdmin: boolean;
  mySchedules: AcademicSchedule[];
  allSchedules: (AcademicSchedule & { users: Pick<User, "name" | "email"> | null })[];
  navConfig: NavConfig | null;
  pageLabel: string;
};

export function SchedulesTabs({
  orgId,
  orgSlug,
  isAdmin,
  mySchedules,
  allSchedules,
  navConfig,
  pageLabel,
}: SchedulesTabsProps) {
  const searchParams = useSearchParams();

  // Auto-select "calendar" tab when returning from OAuth callback
  const initialTab = useMemo<TabId>(() => {
    const hasCalendarParam = searchParams.has("calendar") || searchParams.has("error");
    return hasCalendarParam ? "calendar" : "team";
  }, [searchParams]);

  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || isAdmin);

  return (
    <div className="space-y-6">
      {/* Pill-style tab navigation */}
      <div className="bg-muted/50 rounded-xl p-1 inline-flex">
        <nav className="flex gap-1 overflow-x-auto" aria-label="Schedule tabs">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-2 whitespace-nowrap py-2.5 px-4 text-sm font-medium rounded-lg
                transition-all duration-200
                ${activeTab === tab.id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/50"
                }
              `}
              aria-current={activeTab === tab.id ? "page" : undefined}
            >
              <span className={activeTab === tab.id ? "text-org-secondary" : ""}>{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="animate-fade-in">
        {activeTab === "team" && (
          <TeamScheduleTab orgId={orgId} isAdmin={isAdmin} />
        )}
        {activeTab === "upcoming" && (
          <UpcomingEventsTab orgId={orgId} />
        )}
        {activeTab === "calendar" && (
          <MyCalendarTab
            orgId={orgId}
            orgSlug={orgSlug}
            mySchedules={mySchedules}
            navConfig={navConfig}
            pageLabel={pageLabel}
          />
        )}
        {activeTab === "availability" && (
          <AvailabilityTab
            orgId={orgId}
            isAdmin={isAdmin}
            mySchedules={mySchedules}
            allSchedules={allSchedules}
          />
        )}
      </div>
    </div>
  );
}
