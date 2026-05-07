import { UserContent } from "@/components/i18n/UserContent";

interface MessageTopBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  translateTitle?: boolean;
  translateSubtitle?: boolean;
}

export function MessageTopBar({
  title,
  subtitle,
  actions,
  translateTitle = false,
  translateSubtitle = false,
}: MessageTopBarProps) {
  return (
    <div className="h-14 border-b border-border px-4 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {translateTitle ? (
          <UserContent as="h2" className="font-semibold text-foreground text-sm truncate">
            {title}
          </UserContent>
        ) : (
          <h2 className="font-semibold text-foreground text-sm truncate">{title}</h2>
        )}
        {subtitle && (
          translateSubtitle ? (
            <UserContent as="span" className="text-xs text-muted-foreground flex-shrink-0">
              {subtitle}
            </UserContent>
          ) : (
            <span className="text-xs text-muted-foreground flex-shrink-0">{subtitle}</span>
          )
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
