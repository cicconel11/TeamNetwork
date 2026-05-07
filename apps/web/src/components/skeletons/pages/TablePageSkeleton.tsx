import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";
import { SkeletonTableRow } from "../SkeletonTableRow";
import { SkeletonStatCard } from "../SkeletonStatCard";

interface TablePageSkeletonProps {
  columns?: number;
  rowCount?: number;
  showStats?: boolean;
  statsCount?: number;
}

export function TablePageSkeleton({
  columns = 5,
  rowCount = 5,
  showStats = false,
  statsCount = 3
}: TablePageSkeletonProps) {
  return (
    <div>
      {/* PageHeader skeleton */}
      <div className="mb-8">
        <Skeleton className="h-8 w-32 mb-2" />
        <Skeleton className="h-5 w-56" />
      </div>

      {/* Stats cards skeleton */}
      {showStats && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2">
            <Card className="p-6">
              <Skeleton className="h-6 w-48 mb-4" />
              <Skeleton className="h-10 w-full mb-3" />
              <Skeleton className="h-10 w-2/3" />
            </Card>
          </div>
          <div className="space-y-3">
            {Array.from({ length: statsCount }).map((_, i) => (
              <SkeletonStatCard key={i} />
            ))}
          </div>
        </div>
      )}

      {/* Table skeleton */}
      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b border-border">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {Array.from({ length: columns }).map((_, i) => (
                  <th key={i} className="text-left p-4">
                    <Skeleton className="h-4 w-20" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Array.from({ length: rowCount }).map((_, i) => (
                <SkeletonTableRow key={i} columns={columns} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
