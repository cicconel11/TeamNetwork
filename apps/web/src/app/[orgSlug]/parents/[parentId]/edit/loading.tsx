import { Card } from "@/components/ui";

/** Route-level loading UI for the parent edit page. */
export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* Page header skeleton */}
      <div className="mb-6 flex items-center gap-3">
        <div className="h-8 bg-muted rounded-xl w-32" />
      </div>

      <Card className="max-w-2xl p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="h-10 bg-muted rounded-xl" />
          <div className="h-10 bg-muted rounded-xl" />
        </div>
        <div className="h-10 bg-muted rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="h-10 bg-muted rounded-xl" />
          <div className="h-10 bg-muted rounded-xl" />
        </div>
        <div className="h-10 bg-muted rounded-xl" />
        <div className="h-10 bg-muted rounded-xl" />
        <div className="h-10 bg-muted rounded-xl" />
        <div className="h-24 bg-muted rounded-xl" />
        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <div className="h-9 bg-muted rounded-xl w-20" />
          <div className="h-9 bg-muted rounded-xl w-28" />
        </div>
      </Card>
    </div>
  );
}
