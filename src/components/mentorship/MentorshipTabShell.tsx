"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { MentorshipTab } from "@/lib/mentorship/view-state";

interface MentorshipTabShellProps {
  activeTab: MentorshipTab;
  orgSlug: string;
  content: React.ReactNode;
  showProposalsTab: boolean;
  proposalCount?: number;
}

export function MentorshipTabShell({
  activeTab,
  orgSlug,
  content,
  showProposalsTab,
  proposalCount,
}: MentorshipTabShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tMentorship = useTranslations("mentorship");
  const tabs: MentorshipTab[] = showProposalsTab
    ? ["activity", "directory", "proposals"]
    : ["activity", "directory"];
  const [selectedTab, setSelectedTab] = useState<MentorshipTab>(activeTab);

  useEffect(() => {
    setSelectedTab(activeTab);
  }, [activeTab]);

  const labelFor = (tab: MentorshipTab): string => {
    try {
      if (tab === "activity") return tMentorship("tabActivity");
      if (tab === "directory") return tMentorship("tabDirectory");
      return tMentorship("tabProposals");
    } catch {
      if (tab === "activity") return "Activity";
      if (tab === "directory") return "Directory";
      return "Proposals";
    }
  };

  const buildTabUrl = (tab: MentorshipTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    return `/${orgSlug}/mentorship?${params.toString()}`;
  };

  const handleTabClick = (tab: MentorshipTab) => {
    setSelectedTab(tab);
    router.replace(buildTabUrl(tab), { scroll: false });
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    tab: MentorshipTab
  ) => {
    const currentIndex = tabs.indexOf(tab);
    let nextIndex = currentIndex;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else {
      return;
    }

    const nextTab = tabs[nextIndex];
    setSelectedTab(nextTab);
    router.replace(buildTabUrl(nextTab), { scroll: false });
  };

  const tabButtonClass = (tab: MentorshipTab) =>
    `px-3 py-2 text-[13px] font-medium transition-all duration-200 relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
      selectedTab === tab
        ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1.5px] after:bg-foreground"
        : "text-muted-foreground/70 hover:text-foreground hover:after:absolute hover:after:bottom-0 hover:after:left-0 hover:after:right-0 hover:after:h-px hover:after:bg-muted-foreground/20 transition-colors"
    }`;

  return (
    <div className="space-y-0 animate-fade-in">
      <div className="mb-4">
        <div className="flex gap-0">
          {tabs.map((tab) => (
            <div key={tab} onKeyDown={(e) => handleKeyDown(e, tab)}>
              <button
                onClick={() => handleTabClick(tab)}
                aria-label={labelFor(tab)}
                aria-selected={selectedTab === tab}
                role="tab"
                className={tabButtonClass(tab)}
              >
                {labelFor(tab)}
                {tab === "proposals" && proposalCount !== undefined && proposalCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-semibold rounded-full bg-[var(--muted)] text-[var(--foreground)]">
                    {proposalCount}
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="animate-fade-in">{content}</div>
    </div>
  );
}
