import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Top bar skeleton */}
      <div className="h-14 border-b border-border px-4 flex items-center gap-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-20" />
      </div>

      {/* Messages skeleton */}
      <div className="flex-1 p-4 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-12" />
              </div>
              <Skeleton className="h-10 w-64 rounded-lg" />
            </div>
          </div>
        ))}
      </div>

      {/* Composer skeleton */}
      <div className="border-t border-border p-3">
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}
