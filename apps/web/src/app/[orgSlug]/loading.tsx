import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";

export default function Loading() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
      {/* Main column */}
      <div>
        {/* Composer skeleton */}
        <Card className="px-4 py-3 mb-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <Skeleton className="h-10 flex-1 rounded-full" />
          </div>
        </Card>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-px flex-1 bg-border/50" />
          <Skeleton className="h-3 w-12" />
          <div className="h-px flex-1 bg-border/50" />
        </div>

        {/* Post skeletons */}
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="px-4 pt-4 pb-3">
              <div className="flex items-start gap-3">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                  <Skeleton className="h-4 w-full mb-1" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
              <div className="flex mt-3 pt-2.5 border-t border-border/40">
                <Skeleton className="h-8 flex-1 rounded-lg" />
                <Skeleton className="h-8 flex-1 rounded-lg ml-2" />
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Sidebar skeleton — hidden on mobile */}
      <aside className="hidden xl:block">
        <div className="sticky top-8 space-y-4">
          <Card className="p-4">
            <Skeleton className="h-3 w-16 mb-3" />
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-8" />
                </div>
              ))}
            </div>
          </Card>
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-4 w-32 mb-3" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </Card>
          ))}
        </div>
      </aside>
    </div>
  );
}
