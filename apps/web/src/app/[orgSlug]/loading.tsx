import { SkeletonStatCard } from "@/components/skeletons/SkeletonStatCard";
import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";

export default function Loading() {
  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Announcements skeleton */}
        <Card>
          <div className="p-6 border-b border-border">
            <Skeleton className="h-5 w-48" />
          </div>
          <div className="divide-y divide-border">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4">
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-3 w-full mb-1" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </Card>

        {/* Events skeleton */}
        <Card>
          <div className="p-6 border-b border-border">
            <Skeleton className="h-5 w-40" />
          </div>
          <div className="divide-y divide-border">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 flex items-center gap-4">
                <Skeleton className="h-12 w-12 rounded-xl" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-3/4 mb-2" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Donations skeleton */}
        <Card className="lg:col-span-2">
          <div className="p-6 border-b border-border">
            <Skeleton className="h-5 w-40" />
          </div>
          <div className="p-4 space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-4 w-1/6" />
                <Skeleton className="h-4 w-1/6 ml-auto" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
