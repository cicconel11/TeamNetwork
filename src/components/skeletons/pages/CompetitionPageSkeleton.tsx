import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";
import { SkeletonLeaderboardRow } from "../SkeletonLeaderboardRow";

export function CompetitionPageSkeleton() {
  return (
    <div>
      {/* PageHeader skeleton */}
      <div className="mb-8">
        <Skeleton className="h-8 w-36 mb-2" />
        <Skeleton className="h-5 w-56" />
      </div>

      {/* Hero Leader Banner skeleton */}
      <div className="bg-muted rounded-2xl p-6 md:p-8 mb-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <Skeleton className="h-16 w-16 md:h-20 md:w-20 rounded-full" />
            <div>
              <Skeleton className="h-4 w-28 mb-2" />
              <Skeleton className="h-8 w-40" />
            </div>
          </div>
          <div className="text-center md:text-right">
            <Skeleton className="h-12 w-24 mb-2" />
            <Skeleton className="h-4 w-12 ml-auto" />
          </div>
        </div>
      </div>

      {/* Leaderboard skeleton */}
      <Card className="overflow-hidden mb-8">
        <div className="p-4 md:p-6 border-b border-border flex items-center justify-between">
          <div>
            <Skeleton className="h-6 w-28 mb-1" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-3 w-8" />
          </div>
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonLeaderboardRow key={i} />
          ))}
        </div>
      </Card>

      {/* Two-Column Grid skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Live Feed skeleton */}
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-5 w-20" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </Card>

        {/* Teams skeleton */}
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div>
              <Skeleton className="h-5 w-16 mb-1" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-4 flex items-center justify-between">
                <div>
                  <Skeleton className="h-5 w-28 mb-1" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
