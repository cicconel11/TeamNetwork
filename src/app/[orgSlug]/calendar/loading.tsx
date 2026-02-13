import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6">
      {/* PageHeader skeleton */}
      <div className="mb-8">
        <Skeleton className="h-8 w-32 mb-2" />
        <Skeleton className="h-5 w-64" />
      </div>

      {/* Tab navigation skeleton */}
      <div className="flex gap-2 border-b border-border pb-4">
        <Skeleton className="h-10 w-28 rounded-lg" />
        <Skeleton className="h-10 w-28 rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>

      {/* Schedule content skeleton */}
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <Skeleton className="h-5 w-48 mb-2" />
                <div className="flex items-center gap-4">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
              <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
