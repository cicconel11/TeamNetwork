import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export interface StatRowLinkProps {
  href: string;
  label: string;
  value: string | number;
  icon: LucideIcon;
}

/** Shared stat row — matches desktop `CompactStatsWidget` rows exactly. */
export function StatRowLink({ href, label, value, icon: Icon }: StatRowLinkProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 group"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground transition-colors group-hover:text-foreground">
        {label}
      </span>
      <span className="shrink-0 text-sm font-semibold font-mono text-foreground">{value}</span>
    </Link>
  );
}
