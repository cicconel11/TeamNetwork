import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";

export function SkeletonEventItem() {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        {/* Date Block */}
        <div className="h-16 w-16 rounded-xl bg-muted flex flex-col items-center justify-center flex-shrink-0">
          <Skeleton className="h-3 w-8 mb-1" />
          <Skeleton className="h-6 w-6" />
        </div>

        {/* Event Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-full mt-2" />
          <div className="flex items-center gap-4 mt-3">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      </div>
    </Card>
  );
}
