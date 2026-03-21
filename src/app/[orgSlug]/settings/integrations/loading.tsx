import { Card } from "@/components/ui";

export default function IntegrationsLoading() {
  return (
    <div className="space-y-6">
      <div className="animate-pulse space-y-2">
        <div className="h-7 bg-muted rounded w-48" />
        <div className="h-4 bg-muted rounded w-72" />
      </div>
      <Card className="p-5">
        <div className="animate-pulse space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 bg-muted rounded" />
            <div className="h-5 bg-muted rounded w-48" />
          </div>
          <div className="h-4 bg-muted rounded w-2/3" />
          <div className="h-9 bg-muted rounded w-40" />
        </div>
      </Card>
    </div>
  );
}
