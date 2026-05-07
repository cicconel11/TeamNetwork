import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";

export function SkeletonMentorshipPairCard() {
  return (
    <Card className="p-6 space-y-4">
      {/* Mentor / Status / Mentee row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <Skeleton className="h-5 w-32 mb-1" />
          <Skeleton className="h-4 w-12" />
        </div>
        <div className="text-center">
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="text-right">
          <Skeleton className="h-5 w-28 mb-1" />
          <Skeleton className="h-4 w-14 ml-auto" />
        </div>
      </div>

      {/* Activity logs */}
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="p-3 rounded-xl bg-muted/50 space-y-1">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* Log form footer */}
      <div className="pt-2 border-t border-border">
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
    </Card>
  );
}
