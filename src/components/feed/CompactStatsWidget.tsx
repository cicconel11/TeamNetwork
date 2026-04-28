import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/Card";
import { StatRowLink } from "@/components/feed/StatRowLink";
import type { StatItem } from "@/components/feed/stat-item-types";

export type { StatItem } from "@/components/feed/stat-item-types";

interface CompactStatsWidgetProps {
  stats: StatItem[];
}

export async function CompactStatsWidget({ stats }: CompactStatsWidgetProps) {
  const t = await getTranslations("pages.dashboard");
  return (
    <Card className="overflow-hidden rounded-xl border-border/70 bg-card/75 p-0 shadow-none backdrop-blur-sm">
      <div className="px-4 pb-2 pt-4">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {t("overview")}
        </h3>
      </div>
      <div className="px-2 pb-2">
        {stats.map((stat) => (
          <StatRowLink key={stat.label} href={stat.href} label={stat.label} value={stat.value} icon={stat.icon} />
        ))}
      </div>
    </Card>
  );
}
