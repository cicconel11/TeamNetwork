import { Skeleton } from "@/components/ui";
import { SkeletonListItem } from "../SkeletonListItem";

interface ListPageSkeletonProps {
  showIcon?: boolean;
  itemCount?: number;
  lines?: number;
  showFilters?: boolean;
}

export function ListPageSkeleton({
  showIcon = false,
  itemCount = 5,
  lines = 2,
  showFilters = false
}: ListPageSkeletonProps) {
  return (
    <div>
      {/* PageHeader skeleton */}
      <div className="mb-8">
        <Skeleton className="h-8 w-36 mb-2" />
        <Skeleton className="h-5 w-32" />
      </div>

      {/* Optional filters skeleton */}
      {showFilters && (
        <div className="flex flex-wrap gap-2 mb-6">
          <Skeleton className="h-10 w-24 rounded-xl" />
          <Skeleton className="h-10 w-20 rounded-xl" />
        </div>
      )}

      {/* List skeleton */}
      <div className="space-y-4">
        {Array.from({ length: itemCount }).map((_, i) => (
          <SkeletonListItem key={i} showIcon={showIcon} lines={lines} />
        ))}
      </div>
    </div>
  );
}
