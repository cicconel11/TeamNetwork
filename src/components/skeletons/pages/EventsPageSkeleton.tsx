import { Skeleton } from "@/components/ui";
import { SkeletonEventItem } from "../SkeletonEventItem";

export function EventsPageSkeleton() {
  return (
    <div>
      {/* PageHeader skeleton */}
      <div className="mb-8">
        <Skeleton className="h-8 w-24 mb-2" />
        <Skeleton className="h-5 w-40" />
      </div>

      {/* Filter skeleton */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Skeleton className="h-10 w-24 rounded-xl" />
        <Skeleton className="h-10 w-16 rounded-xl" />
        <div className="w-px bg-border mx-2" />
        <Skeleton className="h-10 w-20 rounded-xl" />
        <Skeleton className="h-10 w-16 rounded-xl" />
        <Skeleton className="h-10 w-20 rounded-xl" />
      </div>

      {/* Events list skeleton */}
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonEventItem key={i} />
        ))}
      </div>
    </div>
  );
}
