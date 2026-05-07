import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";

export function SkeletonDocumentFormCard() {
  return (
    <Card className="p-5">
      <div className="space-y-3">
        {/* Icon + Title + Badge row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 flex-shrink-0" />
            <Skeleton className="h-5 w-40" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>

        {/* Description (2 lines) */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>

        {/* Button footer */}
        <div className="flex items-center justify-end pt-2">
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
      </div>
    </Card>
  );
}
