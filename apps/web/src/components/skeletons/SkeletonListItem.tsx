import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";

interface SkeletonListItemProps {
  showIcon?: boolean;
  lines?: number;
}

export function SkeletonListItem({ showIcon = false, lines = 2 }: SkeletonListItemProps) {
  return (
    <Card className="p-6">
      <div className="flex items-start gap-4">
        {showIcon && (
          <Skeleton className="h-8 w-8 rounded-lg flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-32 mb-3" />
          {Array.from({ length: lines }).map((_, i) => (
            <Skeleton key={i} className={`h-4 ${i === lines - 1 ? "w-3/4" : "w-full"} ${i > 0 ? "mt-2" : ""}`} />
          ))}
        </div>
      </div>
    </Card>
  );
}
