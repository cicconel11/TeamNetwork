import { Card } from "@/components/ui";

/** Route-level loading UI for the parent detail page. */
export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* Page header skeleton */}
      <div className="mb-6 flex items-center justify-between">
        <div className="h-8 bg-muted rounded-xl w-48" />
        <div className="h-9 bg-muted rounded-xl w-24" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile card skeleton */}
        <Card className="p-6 lg:col-span-1">
          <div className="text-center space-y-3">
            <div className="h-20 w-20 bg-muted rounded-full mx-auto" />
            <div className="h-6 bg-muted rounded-xl w-36 mx-auto" />
            <div className="h-4 bg-muted rounded-xl w-28 mx-auto" />
            <div className="h-6 bg-muted rounded-xl w-20 mx-auto" />
          </div>
        </Card>

        {/* Details card skeleton */}
        <Card className="p-6 lg:col-span-2">
          <div className="h-5 bg-muted rounded-xl w-32 mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <div className="h-3 bg-muted rounded w-20" />
                <div className="h-5 bg-muted rounded-xl w-32" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
