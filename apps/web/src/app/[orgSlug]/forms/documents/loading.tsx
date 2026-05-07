import { Skeleton } from "@/components/ui";
import { SkeletonDocumentFormCard } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      {/* PageHeader skeleton with back link */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-5 w-16" />
        </div>
        <Skeleton className="h-8 w-44 mb-2" />
        <Skeleton className="h-5 w-80" />
      </div>

      {/* Grid of document cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonDocumentFormCard key={i} />
        ))}
      </div>
    </div>
  );
}
