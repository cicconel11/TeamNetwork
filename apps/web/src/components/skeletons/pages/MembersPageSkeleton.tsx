import { Skeleton } from "@/components/ui";
import { SkeletonMemberCard } from "../SkeletonMemberCard";

export function MembersPageSkeleton() {
  return (
    <div>
      {/* PageHeader skeleton */}
      <div className="mb-8">
        <Skeleton className="h-8 w-32 mb-2" />
        <Skeleton className="h-5 w-48" />
      </div>

      {/* Filter skeleton */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Skeleton className="h-10 w-20 rounded-xl" />
        <Skeleton className="h-10 w-24 rounded-xl" />
        <Skeleton className="h-10 w-28 rounded-xl" />
      </div>

      {/* Grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonMemberCard key={i} />
        ))}
      </div>
    </div>
  );
}
