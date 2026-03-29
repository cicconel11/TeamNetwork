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
    <Card className="overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("overview")}
        </h3>
      </div>
      <div className="divide-y divide-border/50">
        {stats.map((stat) => (
          <StatRowLink key={stat.label} href={stat.href} label={stat.label} value={stat.value} icon={stat.icon} />
        ))}
      </div>
    </Card>
  );
}
