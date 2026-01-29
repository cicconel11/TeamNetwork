import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";

function SkeletonRecordCard() {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <Skeleton className="h-5 w-32 mb-2" />
          <Skeleton className="h-8 w-24 mb-2" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>
    </Card>
  );
}

export default function Loading() {
  return (
    <div>
      {/* PageHeader skeleton */}
      <div className="mb-8">
        <Skeleton className="h-8 w-24 mb-2" />
        <Skeleton className="h-5 w-48" />
      </div>

      {/* Category filters skeleton */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Skeleton className="h-10 w-28 rounded-xl" />
        <Skeleton className="h-10 w-24 rounded-xl" />
        <Skeleton className="h-10 w-20 rounded-xl" />
      </div>

      {/* Records by category skeleton */}
      <div className="space-y-8">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i}>
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-6 w-32" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, j) => (
                <SkeletonRecordCard key={j} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
