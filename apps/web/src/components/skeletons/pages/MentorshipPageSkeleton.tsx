import { Skeleton } from "@/components/ui";
import { SkeletonMentorshipPairCard } from "../SkeletonMentorshipPairCard";

export function MentorshipPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* PageHeader skeleton */}
      <div>
        <Skeleton className="h-8 w-36 mb-2" />
        <Skeleton className="h-5 w-56" />
      </div>

      {/* Admin panel skeleton */}
      <div className="p-4 rounded-xl bg-muted/30 space-y-3">
        <Skeleton className="h-5 w-40" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-10 w-32 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
        </div>
      </div>

      {/* Pair cards */}
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonMentorshipPairCard key={i} />
        ))}
      </div>
    </div>
  );
}
