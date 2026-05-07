import { Skeleton } from "@/components/ui";
import { Card } from "@/components/ui";

export function SkeletonStatCard() {
  return (
    <Card className="p-5">
      <Skeleton className="h-4 w-24 mb-2" />
      <Skeleton className="h-8 w-32" />
    </Card>
  );
}
