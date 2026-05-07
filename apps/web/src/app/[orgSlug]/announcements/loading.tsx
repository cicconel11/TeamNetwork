import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div>
      {/* Header skeleton */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-6 w-8 rounded-full" />
        </div>
        <Skeleton className="h-10 w-28 rounded-xl" />
      </div>

      {/* Search bar skeleton */}
      <Skeleton className="h-10 w-full mb-6 rounded-xl" />

      {/* Card skeletons */}
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card p-6">
            <div className="flex items-start gap-4">
              <Skeleton className="h-10 w-10 rounded-xl flex-shrink-0" />
              <div className="flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-5 w-3/4" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-5/6" />
                  <Skeleton className="h-3.5 w-2/3" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
