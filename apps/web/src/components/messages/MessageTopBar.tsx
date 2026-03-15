interface MessageTopBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function MessageTopBar({ title, subtitle, actions }: MessageTopBarProps) {
  return (
    <div className="h-14 border-b border-border px-4 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <h2 className="font-semibold text-foreground text-sm truncate">{title}</h2>
        {subtitle && (
          <span className="text-xs text-muted-foreground flex-shrink-0">{subtitle}</span>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
