import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";
import { SkeletonEventItem, SkeletonStatCard } from "@/components/skeletons";

export default function Loading() {
  return (
    <div>
      {/* PageHeader skeleton */}
      <div className="mb-8">
        <Skeleton className="h-8 w-32 mb-2" />
        <Skeleton className="h-5 w-64" />
      </div>

      {/* Stats and donation form row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2">
          <Card className="p-6">
            <Skeleton className="h-6 w-40 mb-4" />
            <Skeleton className="h-10 w-full mb-3" />
            <Skeleton className="h-10 w-2/3" />
          </Card>
        </div>
        <Card className="p-6 space-y-3">
          <div>
            <Skeleton className="h-4 w-32 mb-1" />
            <Skeleton className="h-8 w-24 mb-1" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-6 w-48 rounded-full" />
        </Card>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonStatCard key={i} />
        ))}
      </div>

      {/* Filter skeleton */}
      <div className="flex gap-2 mb-6">
        <Skeleton className="h-10 w-24 rounded-xl" />
        <Skeleton className="h-10 w-16 rounded-xl" />
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
