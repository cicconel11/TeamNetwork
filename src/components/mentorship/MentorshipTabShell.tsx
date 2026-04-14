"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MentorshipTab } from "@/lib/mentorship/view-state";

interface MentorshipTabShellProps {
  initialTab: MentorshipTab;
  orgSlug: string;
  activity: React.ReactNode;
  directory: React.ReactNode;
}

const TAB_LABELS: Record<MentorshipTab, string> = {
  activity: "Activity",
  directory: "Directory",
};

const TAB_ORDER: MentorshipTab[] = ["activity", "directory"];

export function MentorshipTabShell({
  initialTab,
  orgSlug,
  activity,
  directory,
}: MentorshipTabShellProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<MentorshipTab>(initialTab);

  const buildTabUrl = (tab: MentorshipTab) => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    return `/${orgSlug}/mentorship?${params.toString()}`;
  };

  const handleTabClick = (tab: MentorshipTab) => {
    setActiveTab(tab);
    router.replace(buildTabUrl(tab), { scroll: false });
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
    router.replace(buildTabUrl(nextTab), { scroll: false });
  };

  const tabButtonClass = (tab: MentorshipTab) =>
    `px-3 py-2 text-[13px] font-medium transition-all duration-200 relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
      activeTab === tab
        ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1.5px] after:bg-foreground"
        : "text-muted-foreground/70 hover:text-foreground hover:after:absolute hover:after:bottom-0 hover:after:left-0 hover:after:right-0 hover:after:h-px hover:after:bg-muted-foreground/20 transition-colors"
    }`;

  const contentMap: Record<MentorshipTab, React.ReactNode> = {
    activity,
    directory,
  };

  return (
    <div className="space-y-0 animate-fade-in">
      <div className="mb-4">
        <div className="flex gap-0">
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
      </div>

      <div className="animate-fade-in">{contentMap[activeTab]}</div>
    </div>
  );
}
