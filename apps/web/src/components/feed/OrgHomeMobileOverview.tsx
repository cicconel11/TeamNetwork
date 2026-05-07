"use client";

import { useCallback, useId, useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  GraduationCap,
  HandHeart,
  Heart,
  LayoutDashboard,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { StatRowLink } from "@/components/feed/StatRowLink";
import type { MobileStatChip } from "@/components/feed/feed-mobile-stat-types";

const STAT_ICONS: Record<MobileStatChip["iconKey"], LucideIcon> = {
  users: Users,
  "graduation-cap": GraduationCap,
  heart: Heart,
  "calendar-clock": CalendarClock,
  "hand-heart": HandHeart,
};

interface OrgHomeMobileOverviewProps {
  statChips: MobileStatChip[];
  children: React.ReactNode;
}

/**
 * Below-xl overview: same stat rows as desktop `CompactStatsWidget`; widgets behind expand (default collapsed).
 */
export function OrgHomeMobileOverview({ statChips, children }: OrgHomeMobileOverviewProps) {
  const [widgetsOpen, setWidgetsOpen] = useState(false);
  const panelId = useId();
  const toggle = useCallback(() => setWidgetsOpen((o) => !o), []);

  return (
    <section
      className="mb-5 xl:hidden"
      data-testid="org-home-mobile-overview"
      aria-label="Organization overview"
    >
      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            At a glance
          </h3>
        </div>

        {statChips.length > 0 && (
          <div className="divide-y divide-border/50">
            {statChips.map((chip) => {
              const Icon = STAT_ICONS[chip.iconKey];
              return (
                <StatRowLink
                  key={chip.label}
                  href={chip.href}
                  label={chip.label}
                  value={chip.value}
                  icon={Icon}
                />
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={toggle}
          aria-expanded={widgetsOpen}
          aria-controls={panelId}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 border-t border-border/50 bg-muted/10 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:ring-offset-0"
        >
          <LayoutDashboard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-balance">{widgetsOpen ? "Hide events & announcements" : "Show events & announcements"}</span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${widgetsOpen ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>

        <div
          id={panelId}
          role="region"
          aria-label="Events, announcements, and members"
          aria-hidden={!widgetsOpen}
          className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${widgetsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="space-y-4 border-t border-border/50 bg-muted/5 px-4 pb-5 pt-4">{children}</div>
          </div>
        </div>
      </Card>
    </section>
  );
}
