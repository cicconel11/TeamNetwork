"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { MentorshipContextStrip } from "@/components/mentorship/MentorshipContextStrip";
import { MentorDirectory } from "@/components/mentorship/MentorDirectory";
import { MentorshipActivityTab } from "@/components/mentorship/MentorshipActivityTab";
import { MentorshipProposalsTab } from "@/components/mentorship/MentorshipProposalsTab";
import { MenteePreferencesCard } from "@/components/mentorship/MenteePreferencesCard";
import { MentorProfileCard } from "@/components/mentorship/MentorProfileCard";
import { MentorshipMyMatches } from "@/components/mentorship/MentorshipMyMatches";
import type { LoadedMentorshipTabView, MentorshipTabData } from "@/lib/mentorship/tab-data";
import { parseMentorshipTab, type MentorshipTab } from "@/lib/mentorship/view-state";

interface MentorshipTabShellProps {
  activeTab: MentorshipTab;
  orgId: string;
  initialTabData: MentorshipTabData;
  showProposalsTab: boolean;
  showMatchesTab: boolean;
  proposalCount?: number;
}

type TabCache = Partial<Record<MentorshipTab, MentorshipTabData>>;
type TabLoadingState = Partial<Record<MentorshipTab, boolean>>;

export function MentorshipTabShell({
  activeTab,
  orgId,
  initialTabData,
  showProposalsTab,
  showMatchesTab,
  proposalCount,
}: MentorshipTabShellProps) {
  const tMentorship = useTranslations("mentorship");
  const tabs: MentorshipTab[] = useMemo(
    () => [
      ...(showMatchesTab ? (["matches"] as const) : []),
      "activity",
      "directory",
      ...(showProposalsTab ? (["proposals"] as const) : []),
    ],
    [showMatchesTab, showProposalsTab]
  );
  const [selectedTab, setSelectedTab] = useState<MentorshipTab>(activeTab);
  const [tabCache, setTabCache] = useState<TabCache>(() => ({ [activeTab]: initialTabData }));
  const [loadingTabs, setLoadingTabs] = useState<TabLoadingState>({});

  useEffect(() => {
    setSelectedTab(activeTab);
    setTabCache((prev) => ({ ...prev, [activeTab]: initialTabData }));
  }, [activeTab, initialTabData]);

  useEffect(() => {
    const handlePopState = () => {
      setSelectedTab(readTabFromLocation(tabs, activeTab));
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [activeTab, tabs]);

  const fetchTabData = useCallback(
    async (tab: MentorshipTab) => {
      if (tabCache[tab] || loadingTabs[tab]) return;
      setLoadingTabs((prev) => ({ ...prev, [tab]: true }));

      try {
        const url = new URL(
          `/api/organizations/${orgId}/mentorship/view`,
          window.location.origin
        );
        url.searchParams.set("tab", tab);

        const pair = new URL(window.location.href).searchParams.get("pair");
        if (pair) url.searchParams.set("pair", pair);

        const response = await fetch(url.toString(), { method: "GET" });
        if (!response.ok) throw new Error("Failed to load mentorship tab");

        const payload = (await response.json()) as LoadedMentorshipTabView;
        setTabCache((prev) => ({ ...prev, [payload.activeTab]: payload.data }));
        if (payload.activeTab !== tab) {
          setSelectedTab(payload.activeTab);
          replaceHistory(payload.activeTab);
        }
      } catch {
        // Keep the current tab selected and let the existing cached view stay mounted.
      } finally {
        setLoadingTabs((prev) => ({ ...prev, [tab]: false }));
      }
    },
    [loadingTabs, orgId, tabCache]
  );

  useEffect(() => {
    void fetchTabData(selectedTab);
  }, [fetchTabData, selectedTab]);

  const labelFor = (tab: MentorshipTab): string => {
    try {
      if (tab === "activity") return tMentorship("tabActivity");
      if (tab === "directory") return tMentorship("tabDirectory");
      if (tab === "matches") return tMentorship("tabMatches");
      return tMentorship("tabProposals");
    } catch {
      if (tab === "activity") return "Activity";
      if (tab === "directory") return "Directory";
      if (tab === "matches") return "My Matches";
      return "Proposals";
    }
  };

  const handleTabChange = (tab: MentorshipTab) => {
    if (tab === selectedTab) return;
    setSelectedTab(tab);
    pushHistory(tab);
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

    handleTabChange(tabs[nextIndex]);
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
                onClick={() => handleTabChange(tab)}
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

      <div className="relative min-h-[16rem]">
        {tabs.map((tab) => {
          const data = tabCache[tab];
          const isSelected = tab === selectedTab;
          const isLoading = !data && loadingTabs[tab];

          if (!data && !isSelected) return null;

          return (
            <div
              key={tab}
              role="tabpanel"
              aria-hidden={!isSelected}
              className={isSelected ? "animate-fade-in" : "hidden"}
            >
              {data ? renderTabPanel(data) : isLoading ? <TabPanelSkeleton /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderTabPanel(tabData: MentorshipTabData) {
  if (tabData.tab === "activity") {
    return (
      <>
        <MentorshipContextStrip {...tabData.contextStrip} />

        {tabData.showMenteePreferencesCard && (
          <MenteePreferencesCard orgId={tabData.activity.orgId} />
        )}

        {tabData.showMentorProfileCard && (
          <MentorProfileCard orgId={tabData.activity.orgId} />
        )}

        <MentorshipActivityTab {...tabData.activity} />
      </>
    );
  }

  if (tabData.tab === "directory") {
    return <MentorDirectory {...tabData.directory} />;
  }

  if (tabData.tab === "proposals") {
    return <MentorshipProposalsTab {...tabData.proposals} />;
  }

  return <MentorshipMyMatches {...tabData.matches} />;
}

function readTabFromLocation(tabs: MentorshipTab[], fallbackTab: MentorshipTab): MentorshipTab {
  const url = new URL(window.location.href);
  const requestedTab = parseMentorshipTab(url.searchParams.get("tab") ?? undefined);
  return tabs.includes(requestedTab) ? requestedTab : fallbackTab;
}

function pushHistory(tab: MentorshipTab) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  window.history.pushState({ tab }, "", url.toString());
}

function replaceHistory(tab: MentorshipTab) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  window.history.replaceState({ tab }, "", url.toString());
}

function TabPanelSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-5 w-48 rounded bg-muted" />
      <div className="h-24 rounded bg-muted" />
      <div className="h-24 rounded bg-muted" />
    </div>
  );
}
