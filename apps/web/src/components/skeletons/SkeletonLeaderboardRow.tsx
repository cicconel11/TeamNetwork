import { Skeleton } from "@/components/ui";

export function SkeletonLeaderboardRow() {
  return (
    <div className="p-4 md:p-5 flex items-center gap-4">
      {/* Rank Badge */}
      <Skeleton className="h-10 w-10 md:h-12 md:w-12 rounded-full shrink-0" />

      {/* Team Name & Progress Bar */}
      <div className="flex-1 min-w-0">
        <Skeleton className="h-5 w-32 mb-2" />
        <Skeleton className="h-2 w-full rounded-full" />
      </div>

      {/* Points */}
      <div className="text-right shrink-0">
        <Skeleton className="h-8 w-16 ml-auto" />
        <Skeleton className="h-3 w-8 mt-1 ml-auto" />
      </div>
    </div>
  );
}
