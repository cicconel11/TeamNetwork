import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";

function SkeletonFormCard() {
  return (
    <Card className="p-5">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-4 w-full" />
        <div className="flex items-center justify-between pt-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
      </div>
    </Card>
  );
}

export default function Loading() {
  return (
    <div className="space-y-6">
      {/* PageHeader skeleton */}
      <div className="mb-8">
        <Skeleton className="h-8 w-20 mb-2" />
        <Skeleton className="h-5 w-48" />
      </div>

      {/* Forms grid skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonFormCard key={i} />
        ))}
      </div>

      {/* Document Forms section skeleton */}
      <section className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonFormCard key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}
