import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";

function SkeletonTableRow() {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-36" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-28" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-20" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-12" />
      </td>
    </tr>
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
      <div className="flex flex-wrap gap-2 mb-8">
        <Skeleton className="h-10 w-28 rounded-xl" />
        <Skeleton className="h-10 w-24 rounded-xl" />
        <Skeleton className="h-10 w-20 rounded-xl" />
      </div>

      {/* Table sections skeleton */}
      <div className="space-y-10">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i}>
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left"><Skeleton className="h-4 w-14" /></th>
                    <th className="px-4 py-3 text-left"><Skeleton className="h-4 w-14" /></th>
                    <th className="px-4 py-3 text-left"><Skeleton className="h-4 w-12" /></th>
                    <th className="px-4 py-3 text-left"><Skeleton className="h-4 w-10" /></th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 4 }).map((_, j) => (
                    <SkeletonTableRow key={j} />
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
