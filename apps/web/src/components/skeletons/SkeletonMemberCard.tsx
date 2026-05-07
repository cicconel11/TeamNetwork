import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";

export function SkeletonMemberCard() {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="flex-1 min-w-0">
          <Skeleton className="h-5 w-32 mb-2" />
          <Skeleton className="h-4 w-20 mb-2" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-4 w-8" />
          </div>
        </div>
      </div>
    </Card>
  );
}
