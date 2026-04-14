"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MentorshipTab } from "@/lib/mentorship/view-state";

interface MentorshipTabShellProps {
  initialTab: MentorshipTab;
  orgSlug: string;
  overview: React.ReactNode;
  tasks: React.ReactNode;
  meetings: React.ReactNode;
  directory: React.ReactNode;
}

const TAB_LABELS: Record<MentorshipTab, string> = {
  overview: "Overview",
  tasks: "Tasks",
  meetings: "Meetings",
  directory: "Directory",
};

const TAB_ORDER: MentorshipTab[] = [
  "overview",
  "tasks",
  "meetings",
  "directory",
];

export function MentorshipTabShell({
  initialTab,
  orgSlug,
  overview,
  tasks,
  meetings,
  directory,
}: MentorshipTabShellProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<MentorshipTab>(initialTab);

  const handleTabClick = (tab: MentorshipTab) => {
    setActiveTab(tab);
    router.replace(`/${orgSlug}/mentorship?tab=${tab}`, { scroll: false });
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    tab: MentorshipTab
  ) => {
    const currentIndex = TAB_ORDER.indexOf(tab);
    let nextIndex = currentIndex;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % TAB_ORDER.length;
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    } else {
      return;
    }

    const nextTab = TAB_ORDER[nextIndex];
    setActiveTab(nextTab);
    router.replace(`/${orgSlug}/mentorship?tab=${nextTab}`, { scroll: false });
  };

  const tabButtonClass = (tab: MentorshipTab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
      activeTab === tab
        ? "bg-foreground text-background"
        : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
    }`;

  const contentMap: Record<MentorshipTab, React.ReactNode> = {
    overview,
    tasks,
    meetings,
    directory,
  };

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-2 border-b border-muted">
        {TAB_ORDER.map((tab) => (
          <div key={tab} onKeyDown={(e) => handleKeyDown(e, tab)}>
            <button
              onClick={() => handleTabClick(tab)}
              aria-label={TAB_LABELS[tab]}
              aria-selected={activeTab === tab}
              role="tab"
              className={tabButtonClass(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          </div>
        ))}
      </div>

      {/* Tab content */}
      <div className="space-y-4">{contentMap[activeTab]}</div>
    </div>
  );
}
