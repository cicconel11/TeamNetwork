interface PurposeDotLeadersProps {
  purposeTotals: Record<string, number>;
  emptyMessage?: string;
}

export function PurposeDotLeaders({ purposeTotals, emptyMessage }: PurposeDotLeadersProps) {
  const entries = Object.entries(purposeTotals).sort(([, a], [, b]) => b - a);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage || "No donations yet."}</p>;
  }

  return (
    <div className="space-y-3">
      {entries.map(([purpose, cents]) => (
        <div key={purpose} className="flex items-baseline gap-0">
          <span className="text-sm text-foreground shrink-0">{purpose}</span>
          <span className="flex-1 border-b border-dotted border-[var(--border)] mx-2 relative top-[-0.2em]" />
          <span className="text-sm font-mono tabular-nums font-medium text-foreground shrink-0">
            ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      ))}
    </div>
  );
}
