import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";

export interface StatItem {
  label: string;
  value: number | string;
  href: string;
  icon: LucideIcon;
}

interface CompactStatsWidgetProps {
  stats: StatItem[];
}

export function CompactStatsWidget({ stats }: CompactStatsWidgetProps) {
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground font-mono">
          Overview
        </h3>
      </div>
      <div className="divide-y divide-border/50">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors group"
          >
            <stat.icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors flex-1 truncate">
              {stat.label}
            </span>
            <span className="text-sm font-semibold font-mono text-foreground">
              {stat.value}
            </span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
