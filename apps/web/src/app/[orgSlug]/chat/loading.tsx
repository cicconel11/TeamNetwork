import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";

function SkeletonChatGroupCard() {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="flex-1 min-w-0">
          <Skeleton className="h-5 w-32 mb-2" />
          <Skeleton className="h-4 w-48 mb-2" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function Loading() {
  return (
    <div>
      {/* PageHeader skeleton */}
      <div className="mb-8">
        <Skeleton className="h-8 w-16 mb-2" />
        <Skeleton className="h-5 w-24" />
      </div>

      {/* Grid skeleton */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonChatGroupCard key={i} />
        ))}
      </div>
    </div>
  );
}
